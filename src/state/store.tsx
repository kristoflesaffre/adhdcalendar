import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { AppState, CalendarInfo, EventItem, Settings, TaskItem } from '../types';
import { MS_HOUR, addDays, setMinutesOfDay, startOfDay } from '../lib/dates';

const STORAGE_KEY = 'carillon.v1';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const defaultSettings: Settings = {
  theme: 'system',
  googleClientId: '',
  defaultAlarms: [10],
  weekStartsOn: 1,
};

function seedState(): AppState {
  const personal: CalendarInfo = {
    id: 'cal-personal',
    name: 'Personal',
    color: '#206657',
    visible: true,
    source: 'local',
  };
  const work: CalendarInfo = {
    id: 'cal-work',
    name: 'Work',
    color: '#3a5bc7',
    visible: true,
    source: 'local',
  };
  const today = startOfDay(new Date());
  const events: EventItem[] = [
    {
      id: uid(),
      calendarId: 'cal-work',
      title: 'Weekly planning',
      start: setMinutesOfDay(addDays(today, 1), 9 * 60 + 30).getTime(),
      end: setMinutesOfDay(addDays(today, 1), 10 * 60 + 15).getTime(),
      allDay: false,
      alarms: [30, 10],
      recurrence: { freq: 'WEEKLY', interval: 1 },
    },
    {
      id: uid(),
      calendarId: 'cal-personal',
      title: 'Evening run',
      location: 'Citadelpark',
      start: setMinutesOfDay(today, 18 * 60 + 30).getTime(),
      end: setMinutesOfDay(today, 19 * 60 + 15).getTime(),
      allDay: false,
      alarms: [30, 20, 10],
    },
    {
      id: uid(),
      calendarId: 'cal-personal',
      title: 'Dentist',
      location: 'Dr. Maes',
      start: setMinutesOfDay(addDays(today, 3), 14 * 60).getTime(),
      end: setMinutesOfDay(addDays(today, 3), 14 * 60 + 45).getTime(),
      allDay: false,
      alarms: [60, 10],
    },
  ];
  return { calendars: [personal, work], events, tasks: [], settings: defaultSettings };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as AppState;
    return {
      calendars: parsed.calendars ?? [],
      events: parsed.events ?? [],
      tasks: parsed.tasks ?? [],
      settings: { ...defaultSettings, ...parsed.settings },
    };
  } catch {
    return seedState();
  }
}

export type Action =
  | { type: 'event/add'; event: EventItem }
  | { type: 'event/update'; event: EventItem }
  | { type: 'event/patch'; id: string; patch: Partial<EventItem> }
  | { type: 'event/delete'; id: string }
  | { type: 'event/except'; id: string; occStart: number }
  | { type: 'event/move'; id: string; start: number; end: number }
  | { type: 'task/add'; task: TaskItem }
  | { type: 'task/update'; task: TaskItem }
  | { type: 'task/delete'; id: string }
  | { type: 'task/toggle'; id: string; occDue: number }
  | { type: 'calendar/add'; calendar: CalendarInfo }
  | { type: 'calendar/update'; calendar: CalendarInfo }
  | { type: 'calendar/delete'; id: string }
  | { type: 'calendar/toggle'; id: string }
  | { type: 'calendar/importEvents'; calendar: CalendarInfo; events: EventItem[] }
  | { type: 'settings/update'; patch: Partial<Settings> };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'event/add':
      return { ...state, events: [...state.events, action.event] };
    case 'event/update':
      return {
        ...state,
        events: state.events.map((e) => (e.id === action.event.id ? action.event : e)),
      };
    case 'event/patch':
      return {
        ...state,
        events: state.events.map((e) => (e.id === action.id ? { ...e, ...action.patch } : e)),
      };
    case 'event/delete':
      return { ...state, events: state.events.filter((e) => e.id !== action.id) };
    case 'event/except':
      return {
        ...state,
        events: state.events.map((e) =>
          e.id === action.id
            ? { ...e, exceptions: [...(e.exceptions ?? []), action.occStart] }
            : e,
        ),
      };
    case 'event/move':
      return {
        ...state,
        events: state.events.map((e) =>
          e.id === action.id ? { ...e, start: action.start, end: action.end } : e,
        ),
      };
    case 'task/add':
      return { ...state, tasks: [...state.tasks, action.task] };
    case 'task/update':
      return { ...state, tasks: state.tasks.map((t) => (t.id === action.task.id ? action.task : t)) };
    case 'task/delete':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };
    case 'task/toggle':
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (t.id !== action.id) return t;
          const done = t.completedOn ?? [];
          const completedOn = done.includes(action.occDue)
            ? done.filter((d) => d !== action.occDue)
            : [...done, action.occDue];
          return { ...t, completedOn };
        }),
      };
    case 'calendar/add':
      return { ...state, calendars: [...state.calendars, action.calendar] };
    case 'calendar/update':
      return {
        ...state,
        calendars: state.calendars.map((c) => (c.id === action.calendar.id ? action.calendar : c)),
      };
    case 'calendar/delete':
      return {
        ...state,
        calendars: state.calendars.filter((c) => c.id !== action.id),
        events: state.events.filter((e) => e.calendarId !== action.id),
        tasks: state.tasks.filter((t) => t.calendarId !== action.id),
      };
    case 'calendar/toggle':
      return {
        ...state,
        calendars: state.calendars.map((c) =>
          c.id === action.id ? { ...c, visible: !c.visible } : c,
        ),
      };
    case 'calendar/importEvents': {
      // replace any previous import of the same calendar (re-sync)
      const existing = state.calendars.find((c) => c.id === action.calendar.id);
      const calendars = existing
        ? state.calendars.map((c) => (c.id === action.calendar.id ? action.calendar : c))
        : [...state.calendars, action.calendar];
      const events = [
        ...state.events.filter((e) => e.calendarId !== action.calendar.id),
        ...action.events,
      ];
      return { ...state, calendars, events };
    }
    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    default:
      return state;
  }
}

interface StoreValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // storage full or unavailable — keep running in memory
      }
    }, 150);
    return () => clearTimeout(t);
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}

/** default new event: next full half hour, 1h long */
export function draftEvent(calendarId: string, defaultAlarms: number[], at?: number): EventItem {
  const base = at ?? Date.now();
  const d = new Date(base);
  if (at == null) {
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  }
  return {
    id: uid(),
    calendarId,
    title: '',
    start: d.getTime(),
    end: d.getTime() + MS_HOUR,
    allDay: false,
    alarms: [...defaultAlarms],
  };
}
