import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ActiveTimer, AlarmClockItem, AppState, CalendarInfo, EventItem, Settings, TaskItem } from '../types';
import { MS_HOUR, addDays, setMinutesOfDay, startOfDay } from '../lib/dates';
import { DEFAULT_ALARM_SOUND, getAlarmSound } from '../alarm/sounds';
import { db } from '../lib/instant';
import {
  appStateFromRecords,
  hasCloudState,
  initializeCloudState,
  queueCloudStateDiff,
} from './instantSync';
import type { SyncRecord } from './instantSync';
import { SyncLoading, SyncLogin } from '../components/SyncLogin';

const STORAGE_KEY = 'carillon.v1';
const MIGRATION_OWNER_KEY = 'carillon.instant.owner.v1';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const defaultSettings: Settings = {
  theme: 'system',
  googleClientId: '',
  alarmSound: DEFAULT_ALARM_SOUND,
  defaultNotifications: [10080, 1440],
  defaultAlarms: [5],
  weekStartsOn: 1,
};

function seedState(): AppState {
  const personal: CalendarInfo = {
    id: 'cal-personal',
    name: 'Personal',
    color: '#2f8f6f',
    visible: true,
    source: 'local',
  };
  const work: CalendarInfo = {
    id: 'cal-work',
    name: 'Work',
    color: '#2f64c8',
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
      notifications: [10080, 1440],
      alarms: [5],
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
      notifications: [10080, 1440],
      alarms: [5],
    },
    {
      id: uid(),
      calendarId: 'cal-personal',
      title: 'Dentist',
      location: 'Dr. Maes',
      start: setMinutesOfDay(addDays(today, 3), 14 * 60).getTime(),
      end: setMinutesOfDay(addDays(today, 3), 14 * 60 + 45).getTime(),
      allDay: false,
      notifications: [10080, 1440],
      alarms: [5],
    },
  ];
  return {
    calendars: [personal, work],
    events,
    tasks: [],
    alarmClocks: [],
    timers: [],
    settings: defaultSettings,
  };
}

function normalizeState(parsed: AppState): AppState {
  const isLegacyReminderModel = !Array.isArray(parsed.settings?.defaultNotifications);
  const settings = {
    ...defaultSettings,
    ...parsed.settings,
    ...(isLegacyReminderModel
      ? { defaultNotifications: [...defaultSettings.defaultNotifications], defaultAlarms: [5] }
      : {}),
  };
  const calendarById = new Map((parsed.calendars ?? []).map((calendar) => [calendar.id, calendar]));
  const events = (parsed.events ?? []).map((event) => {
    if (Array.isArray(event.notifications)) return event;
    const source = calendarById.get(event.calendarId)?.source;
    const imported = source === 'google' || source === 'ics';
    return {
      ...event,
      notifications: imported ? [...(event.alarms ?? [])] : [...defaultSettings.defaultNotifications],
      alarms: imported ? [5] : [...(event.alarms ?? [5])],
    };
  });
  const tasks = (parsed.tasks ?? []).map((task) => ({
    ...task,
    notifications: Array.isArray(task.notifications)
      ? task.notifications
      : [...defaultSettings.defaultNotifications],
    alarms: Array.isArray(task.alarms) ? task.alarms : [5],
  }));
  return {
    calendars: parsed.calendars ?? [],
    events,
    tasks,
    alarmClocks: parsed.alarmClocks ?? [],
    timers: parsed.timers ?? [],
    settings: { ...settings, alarmSound: getAlarmSound(settings.alarmSound).id },
  };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw) as AppState) : seedState();
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
  | { type: 'alarm/add'; alarm: AlarmClockItem }
  | { type: 'alarm/update'; alarm: AlarmClockItem }
  | { type: 'alarm/delete'; id: string }
  | { type: 'alarm/setEnabled'; id: string; enabled: boolean; anchor?: number }
  | { type: 'timer/start'; timer: ActiveTimer }
  | { type: 'timer/cancel'; id: string }
  | { type: 'timer/pause'; id: string; remaining: number }
  | { type: 'timer/resume'; id: string; endAt: number }
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
      const previousGoogleEvents = new Map(
        state.events
          .filter((event) => event.calendarId === action.calendar.id && event.googleEventId)
          .map((event) => [event.googleEventId!, event]),
      );
      const calendars = existing
        ? state.calendars.map((c) => (c.id === action.calendar.id ? action.calendar : c))
        : [...state.calendars, action.calendar];
      const events = [
        ...state.events.filter((e) => e.calendarId !== action.calendar.id),
        ...action.events.map((event) => {
          const previous = event.googleEventId ? previousGoogleEvents.get(event.googleEventId) : undefined;
          return previous ? { ...event, alarms: previous.alarms } : event;
        }),
      ];
      return { ...state, calendars, events };
    }
    case 'alarm/add':
      return { ...state, alarmClocks: [...state.alarmClocks, action.alarm] };
    case 'alarm/update':
      return {
        ...state,
        alarmClocks: state.alarmClocks.map((a) => (a.id === action.alarm.id ? action.alarm : a)),
      };
    case 'alarm/delete':
      return { ...state, alarmClocks: state.alarmClocks.filter((a) => a.id !== action.id) };
    case 'alarm/setEnabled':
      return {
        ...state,
        alarmClocks: state.alarmClocks.map((a) =>
          a.id === action.id
            ? { ...a, enabled: action.enabled, anchor: action.anchor ?? a.anchor }
            : a,
        ),
      };
    case 'timer/start':
      return { ...state, timers: [...state.timers, action.timer] };
    case 'timer/cancel':
      return { ...state, timers: state.timers.filter((t) => t.id !== action.id) };
    case 'timer/pause':
      return {
        ...state,
        timers: state.timers.map((t) =>
          t.id === action.id ? { ...t, pausedRemaining: action.remaining } : t,
        ),
      };
    case 'timer/resume':
      return {
        ...state,
        timers: state.timers.map((t) =>
          t.id === action.id ? { ...t, pausedRemaining: undefined, endAt: action.endAt } : t,
        ),
      };
    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    default:
      return state;
  }
}

interface StoreValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  sync: {
    email: string;
    status: 'synced' | 'syncing' | 'error';
    error?: string;
  };
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const auth = db.useAuth();
  const user = auth.user;
  const cloud = db.useQuery(
    user
      ? {
          syncRecords: {
            $: { where: { ownerId: user.id } },
          },
        }
      : null,
  );
  const [state, setState] = useState<AppState>(load);
  const stateRef = useRef(state);
  const userIdRef = useRef('');
  const syncReadyRef = useRef(false);
  const initializingRef = useRef(false);
  const pendingSyncRef = useRef(0);
  const [cloudReady, setCloudReady] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error'>('synced');
  const [syncError, setSyncError] = useState('');
  const [initializationError, setInitializationError] = useState('');

  useEffect(() => {
    userIdRef.current = user?.id ?? '';
    syncReadyRef.current = false;
    initializingRef.current = false;
    pendingSyncRef.current = 0;
    setCloudReady(false);
    setInitializing(false);
    setSyncError('');
    setInitializationError('');
  }, [user?.id]);

  useEffect(() => {
    if (!user || cloud.isLoading || cloud.error) return;
    const records = (cloud.data?.syncRecords ?? []) as SyncRecord[];

    if (!hasCloudState(records)) {
      if (initializationError) return;
      if (initializingRef.current) return;
      initializingRef.current = true;
      setInitializing(true);
      setInitializationError('');
      const migrationOwner = localStorage.getItem(MIGRATION_OWNER_KEY);
      const migrationState = !migrationOwner || migrationOwner === user.id ? stateRef.current : seedState();
      void initializeCloudState(migrationState, user.id)
        .then(() => {
          localStorage.setItem(MIGRATION_OWNER_KEY, user.id);
          setSyncStatus('synced');
        })
        .catch((error) => {
          initializingRef.current = false;
          setInitializing(false);
          setSyncStatus('error');
          const message = error instanceof Error ? error.message : 'Could not upload local calendar data.';
          setSyncError(message);
          setInitializationError(message);
        });
      return;
    }

    if (pendingSyncRef.current > 0) return;

    const next = normalizeState(appStateFromRecords(records, stateRef.current));
    if (JSON.stringify(next) !== JSON.stringify(stateRef.current)) {
      stateRef.current = next;
      setState(next);
    }
    syncReadyRef.current = true;
    initializingRef.current = false;
    setInitializing(false);
    setCloudReady(true);
    setSyncStatus('synced');
    setSyncError('');
    setInitializationError('');
  }, [cloud.data, cloud.error, cloud.isLoading, initializationError, syncStatus, user]);

  const dispatch = useCallback((action: Action) => {
    const previous = stateRef.current;
    const next = reducer(previous, action);
    stateRef.current = next;
    setState(next);

    const ownerId = userIdRef.current;
    if (!ownerId || !syncReadyRef.current) return;
    pendingSyncRef.current += 1;
    setSyncStatus('syncing');
    setSyncError('');
    queueCloudStateDiff(
      previous,
      next,
      ownerId,
      () => {
        pendingSyncRef.current = Math.max(0, pendingSyncRef.current - 1);
        if (pendingSyncRef.current === 0) setSyncStatus('synced');
      },
      (error) => {
        pendingSyncRef.current = Math.max(0, pendingSyncRef.current - 1);
        setSyncStatus('error');
        setSyncError(error instanceof Error ? error.message : 'Cloud sync failed.');
      },
    );
  }, []);

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

  const value = useMemo(
    () => ({
      state,
      dispatch,
      sync: {
        email: user?.email ?? '',
        status: syncStatus,
        ...(syncError ? { error: syncError } : {}),
      },
    }),
    [dispatch, state, syncError, syncStatus, user?.email],
  );

  if (auth.isLoading) return <SyncLoading />;
  if (!user) return <SyncLogin initialError={auth.error?.message ?? ''} />;
  if (cloud.error) return <SyncLoading error={cloud.error.message} />;
  if (cloud.isLoading || !cloudReady) {
    return (
      <SyncLoading
        label={initializing ? 'Moving your calendar to the cloud…' : undefined}
        error={initializationError}
        onRetry={
          initializationError
            ? () => {
                initializingRef.current = false;
                setSyncStatus('syncing');
                setInitializationError('');
              }
            : undefined
        }
      />
    );
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}

/** default new event: next full half hour, 1h long */
export function draftEvent(
  calendarId: string,
  defaultNotifications: number[],
  defaultAlarms: number[],
  at?: number,
): EventItem {
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
    notifications: [...defaultNotifications],
    alarms: [...defaultAlarms],
  };
}
