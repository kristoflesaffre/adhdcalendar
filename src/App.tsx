import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AlarmClockItem,
  CalendarInfo,
  EventItem,
  Occurrence,
  TaskItem,
  TaskOccurrence,
  ViewMode,
} from '../src/types';
import { useStore, draftEvent } from './state/store';
import { expandEvents, expandTasks } from './lib/recurrence';
import {
  ALARM_CALENDAR,
  alarmClockEvents,
  alarmClockIdFromEvent,
  nextAlarmMoment,
} from './lib/alarmClocks';
import {
  MS_DAY,
  addDays,
  addMonths,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from './lib/dates';
import { useAlarmEngine } from './alarm/engine';
import { syncTimerLiveActivities } from './native/alarmAudio';
import { AlarmOverlay } from './alarm/AlarmOverlay';
import { ensureAudioUnlocked } from './alarm/sound';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { MonthView } from './components/MonthView';
import { TimeGrid } from './components/TimeGrid';
import { AgendaView } from './components/AgendaView';
import { TodayView } from './components/TodayView';
import { AlarmsView } from './components/AlarmsView';
import { TimersView } from './components/TimersView';
import { AlarmEditor } from './components/AlarmEditor';
import { MobileTopBar } from './components/MobileTopBar';
import { MobileTabBar } from './components/MobileTabBar';
import type { MobileTab } from './components/MobileTabBar';
import type { DesktopTab } from './components/TopBar';
import { MenuDrawer } from './components/MenuDrawer';
import { SwipeViews } from './components/SwipeViews';
import { EventEditor } from './components/EventEditor';
import { EventSheet } from './components/EventSheet';
import { TaskEditor, draftTask } from './components/TaskEditor';
import { EventPopover } from './components/EventPopover';
import { SettingsModal } from './components/SettingsModal';
import { GoogleConnectModal } from './components/GoogleConnectModal';
import { CalendarEditor } from './components/CalendarEditor';
import { CalIcon, Plus, TaskIcon } from './components/icons';
import { dayKey } from './components/MiniMonth';
import { parseIcs } from './lib/ics';
import { fetchIcsText, googleIdFromIcsUrl } from './lib/icsUrl';
import { flushQueue, queueDelete, queueUpsert, scheduleFlush } from './lib/googleSync';
import { fetchGoogleEvents, getAccessToken, isNativeGoogleAuth } from './lib/google';
import { MOBILE_QUERY, useIsMobile } from './hooks/useIsMobile';
import { scheduleWidgetUpdate } from './native/widget';

interface PopoverState {
  occ: Occurrence;
  anchor: DOMRect;
}

interface EditorState {
  draft: EventItem;
  isNew: boolean;
}

interface TaskEditorState {
  draft: TaskItem;
  isNew: boolean;
}

export default function App() {
  const { state, dispatch } = useStore();
  const isMobile = useIsMobile();
  // on mobile the Calendar tab defaults to the Schedule view
  const [view, setView] = useState<ViewMode>(() =>
    window.matchMedia(MOBILE_QUERY).matches ? 'schedule' : 'week',
  );
  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [desktopTransitionDir, setDesktopTransitionDir] = useState<1 | -1>(1);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [taskEditor, setTaskEditor] = useState<TaskEditorState | null>(null);
  const [alarmEditor, setAlarmEditor] = useState<{
    alarm: AlarmClockItem;
    mode: 'full' | 'options';
  } | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [googleOpen, setGoogleOpen] = useState(false);
  const [calEditor, setCalEditor] = useState<{ cal: CalendarInfo | null } | null>(null);
  const [tab, setTab] = useState<MobileTab>('calendar');
  const [desktopTab, setDesktopTab] = useState<DesktopTab>('calendar');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [jumpSignal, setJumpSignal] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  /* clock alarms are projected into the calendar as synthetic events in a
     virtual read-only "Alarms" calendar: every view and the whole real-alarm
     pipeline (native ring included) picks them up for free */
  const alarmEvents = useMemo(() => alarmClockEvents(state.alarmClocks), [state.alarmClocks]);
  const allEvents = useMemo(
    () => (alarmEvents.length ? [...state.events, ...alarmEvents] : state.events),
    [state.events, alarmEvents],
  );
  const allCalendars = useMemo(
    () => (alarmEvents.length ? [...state.calendars, ALARM_CALENDAR] : state.calendars),
    [state.calendars, alarmEvents.length],
  );
  const engineState = useMemo(
    () => ({ ...state, events: allEvents, calendars: allCalendars }),
    [state, allEvents, allCalendars],
  );

  const { ringing, dismiss, snooze, nextAlarm } = useAlarmEngine(engineState);

  /* stopping a rung timer also clears its card */
  const dismissRinging = useCallback(
    (key: string) => {
      const m = key.match(/^timer:([^@]+)@/);
      if (m) dispatch({ type: 'timer/cancel', id: m[1] });
      dismiss(key);
    },
    [dismiss, dispatch],
  );

  /* a fired one-time alarm switches itself off, like iOS */
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const alarm of state.alarmClocks) {
        if (alarm.enabled && !alarm.repeatDays.length && alarm.anchor < now - 60_000) {
          dispatch({ type: 'alarm/setEnabled', id: alarm.id, enabled: false });
        }
      }
    };
    check();
    const id = window.setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [state.alarmClocks, dispatch]);

  /* ---- two-way Google sync plumbing ---- */
  const calById = useMemo(() => new Map(state.calendars.map((c) => [c.id, c])), [state.calendars]);
  const onSynced = useCallback(
    (localEventId: string, googleEventId: string) =>
      dispatch({ type: 'event/patch', id: localEventId, patch: { googleEventId } }),
    [dispatch],
  );
  /** call after any local mutation of an event in a two-way Google calendar */
  const pushToGoogle = useCallback(
    (ev: EventItem, kind: 'upsert' | 'delete') => {
      const cal = calById.get(ev.calendarId);
      if (!cal?.googleId || cal.readOnly) return;
      if (kind === 'upsert') queueUpsert(ev, cal.googleId);
      else queueDelete(ev, cal.googleId);
      scheduleFlush(state.settings.googleClientId, onSynced);
    },
    [calById, state.settings.googleClientId, onSynced],
  );

  /* theme */
  useEffect(() => {
    const apply = () => {
      const pref = state.settings.theme;
      const dark =
        pref === 'dark' ||
        (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [state.settings.theme]);

  /* auto-sync connected Google calendars once per app start */
  useEffect(() => {
    let cancelled = false;

    // a calendar connected both read-only (secret address) and two-way is
    // the same calendar twice — drop the read-only twin, two-way wins
    const twoWayIds = new Set(
      state.calendars.filter((c) => c.googleId && !c.icsUrl).map((c) => c.googleId!),
    );
    const duplicates = state.calendars.filter((c) => {
      const id = googleIdFromIcsUrl(c.icsUrl);
      return id !== null && twoWayIds.has(id);
    });
    for (const dup of duplicates) dispatch({ type: 'calendar/delete', id: dup.id });
    const dupIds = new Set(duplicates.map((d) => d.id));

    (async () => {
      // 1) read-only links (secret address): just pull
      for (const cal of state.calendars.filter((c) => c.icsUrl && !dupIds.has(c.id))) {
        try {
          const text = await fetchIcsText(cal.icsUrl!);
          if (cancelled) return;
          const parsed = parseIcs(
            text,
            state.settings.defaultAlarms,
            state.settings.defaultNotifications,
          );
          dispatch({
            type: 'calendar/importEvents',
            calendar: { ...cal, syncedAt: Date.now() },
            events: parsed.events.map((e) => ({ ...e, calendarId: cal.id })),
          });
        } catch {
          // offline or link revoked — keep the cached events
        }
      }

      // 2) two-way calendars: push pending local changes first, then pull
      const twoWay = state.calendars.filter((c) => c.googleId && !c.icsUrl);
      const clientId = state.settings.googleClientId;
      if (!twoWay.length || (!clientId && !isNativeGoogleAuth())) return;
      const left = await flushQueue(clientId, onSynced);
      if (left > 0 || cancelled) return; // sign-in needed or offline — pull would clobber local edits
      const token = await getAccessToken(clientId);
      if (!token || cancelled) return;
      for (const cal of twoWay) {
        try {
          const events = await fetchGoogleEvents(
            token,
            cal.googleId!,
            cal.id,
            state.settings.defaultAlarms,
            state.settings.defaultNotifications,
          );
          if (cancelled) return;
          dispatch({
            type: 'calendar/importEvents',
            calendar: { ...cal, syncedAt: Date.now() },
            events,
          });
        } catch {
          // keep cached events
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // mount only: one sync per app start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* keep the iOS home-screen widget in sync (incl. clock alarms) */
  useEffect(() => {
    scheduleWidgetUpdate(engineState);
  }, [engineState]);

  /* running timers live on the lock screen as Live Activities */
  useEffect(() => {
    void syncTimerLiveActivities(state.timers);
  }, [state.timers]);

  /* unlock audio on the first user gesture so alarms can ring */
  useEffect(() => {
    const unlock = () => ensureAudioUnlocked();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  /* visible range for the current view; spanDays powers swipe paging */
  const { rangeStart, rangeEnd, days, spanDays } = useMemo(() => {
    const wkStart = state.settings.weekStartsOn;
    if (view === 'day' || view === 'schedule') {
      const s = startOfDay(date);
      return { rangeStart: s.getTime(), rangeEnd: s.getTime() + MS_DAY, days: [s], spanDays: 1 };
    }
    if (view === '3day') {
      const s = startOfDay(date);
      return {
        rangeStart: s.getTime(),
        rangeEnd: s.getTime() + 3 * MS_DAY,
        days: Array.from({ length: 3 }, (_, i) => addDays(s, i)),
        spanDays: 3,
      };
    }
    if (view === 'week') {
      const s = startOfWeek(date, wkStart);
      return {
        rangeStart: s.getTime(),
        rangeEnd: s.getTime() + 7 * MS_DAY,
        days: Array.from({ length: 7 }, (_, i) => addDays(s, i)),
        spanDays: 7,
      };
    }
    const gs = startOfWeek(startOfMonth(date), wkStart);
    return { rangeStart: gs.getTime(), rangeEnd: addDays(gs, 42).getTime(), days: [] as Date[], spanDays: 0 };
  }, [view, date, state.settings.weekStartsOn]);

  /* widen by one span on each side so the swipe neighbours have data */
  const swipePad = spanDays * MS_DAY;

  const visibleIds = useMemo(
    () => new Set(allCalendars.filter((c) => c.visible).map((c) => c.id)),
    [allCalendars],
  );

  const occurrences = useMemo(
    () => expandEvents(allEvents, visibleIds, rangeStart - swipePad, rangeEnd + swipePad),
    [allEvents, visibleIds, rangeStart, rangeEnd, swipePad],
  );

  /* the mobile Schedule view scrolls through real time, not the nav date */
  const agendaOccurrences = useMemo(() => {
    const now = Date.now();
    return expandEvents(allEvents, visibleIds, now - 3 * MS_DAY, now + 180 * MS_DAY);
  }, [allEvents, visibleIds]);

  const taskOccurrences = useMemo(
    () => expandTasks(state.tasks, visibleIds, rangeStart - swipePad, rangeEnd + swipePad),
    [state.tasks, visibleIds, rangeStart, rangeEnd, swipePad],
  );

  const agendaTasks = useMemo(() => {
    const now = Date.now();
    return expandTasks(state.tasks, visibleIds, now - 3 * MS_DAY, now + 180 * MS_DAY);
  }, [state.tasks, visibleIds]);

  /* ---- task handlers ---- */
  const openCreateTask = useCallback(
    (at?: number) => {
      const firstWritable = state.calendars.find((c) => !c.readOnly);
      if (!firstWritable) return;
      setCreateMenuOpen(false);
      setPopover(null);
      setEditor(null);
      setTaskEditor({
        draft: draftTask(
          firstWritable.id,
          state.settings.defaultNotifications,
          state.settings.defaultAlarms,
          at,
        ),
        isNew: true,
      });
    },
    [state.calendars, state.settings.defaultAlarms, state.settings.defaultNotifications],
  );

  const toggleTask = useCallback(
    (occ: TaskOccurrence) => dispatch({ type: 'task/toggle', id: occ.task.id, occDue: occ.due }),
    [dispatch],
  );

  const openTask = useCallback((occ: TaskOccurrence) => {
    setPopover(null);
    setTaskEditor({ draft: { ...occ.task }, isNew: false });
  }, []);

  const saveTask = useCallback(
    (task: TaskItem) => {
      if (taskEditor?.isNew) dispatch({ type: 'task/add', task });
      else dispatch({ type: 'task/update', task });
      setTaskEditor(null);
    },
    [dispatch, taskEditor],
  );

  /* dots in the mini month: current ± 1 month */
  const busyDays = useMemo(() => {
    const s = addMonths(startOfMonth(date), -1).getTime();
    const e = addMonths(startOfMonth(date), 2).getTime();
    const set = new Set<string>();
    for (const occ of expandEvents(allEvents, visibleIds, s, e)) {
      set.add(dayKey(new Date(occ.start)));
    }
    return set;
  }, [allEvents, visibleIds, date]);

  const navigate = useCallback(
    (dir: -1 | 0 | 1) => {
      setPopover(null);
      setDesktopTransitionDir(dir === -1 ? -1 : 1);
      if (dir === 0) {
        setDate(startOfDay(new Date()));
        return;
      }
      setDate((d) =>
        view === 'month'
          ? addMonths(d, dir)
          : addDays(d, dir * (view === 'week' ? 7 : view === '3day' ? 3 : 1)),
      );
    },
    [view],
  );

  const openCreate = useCallback(
    (start?: number, end?: number, allDay = false) => {
      const firstWritable = state.calendars.find((c) => !c.readOnly);
      if (!firstWritable) return;
      setCreateMenuOpen(false);
      const d = draftEvent(
        firstWritable.id,
        state.settings.defaultNotifications,
        state.settings.defaultAlarms,
        start,
      );
      if (start && end) {
        d.end = end;
      }
      d.allDay = allDay;
      setPopover(null);
      setEditor({ draft: d, isNew: true });
    },
    [state.calendars, state.settings.defaultAlarms, state.settings.defaultNotifications],
  );

  /* tapping an alarm's calendar block opens the alarm editor, not the event popover */
  const openEventPopover = useCallback(
    (occ: Occurrence, anchor: DOMRect) => {
      const alarmId = alarmClockIdFromEvent(occ.event.id);
      if (alarmId) {
        const alarm = state.alarmClocks.find((a) => a.id === alarmId);
        if (alarm) {
          setPopover(null);
          setAlarmEditor({ alarm, mode: 'full' });
          return;
        }
      }
      setPopover({ occ, anchor });
    },
    [state.alarmClocks],
  );

  const openOccurrence = useCallback((occ: Occurrence, anchor?: DOMRect) => {
    setDate(startOfDay(occ.start));
    if (anchor) {
      setPopover({ occ, anchor });
    } else {
      const r = new DOMRect(window.innerWidth / 2 - 160, window.innerHeight / 3, 0, 0);
      setPopover({ occ, anchor: r });
    }
  }, []);

  const openNextAlarm = useCallback(() => {
    if (!nextAlarm) return;
    const alarmId = alarmClockIdFromEvent(nextAlarm.base.eventId);
    if (alarmId) {
      const alarm = state.alarmClocks.find((a) => a.id === alarmId);
      if (alarm) {
        setAlarmEditor({ alarm, mode: 'full' });
        return;
      }
    }
    const event = state.events.find((ev) => ev.id === nextAlarm.base.eventId);
    if (event) {
      const start = nextAlarm.base.occStart;
      openOccurrence(
        {
          event,
          start,
          end: start + (event.end - event.start),
          key: `${event.id}@${start}`,
        },
      );
      return;
    }

    const task = state.tasks.find((item) => item.id === nextAlarm.base.eventId);
    if (task) {
      openTask({
        task,
        due: nextAlarm.base.occStart,
        key: `${task.id}@${nextAlarm.base.occStart}`,
        completed: task.completedOn?.includes(nextAlarm.base.occStart) ?? false,
      });
    }
  }, [nextAlarm, openOccurrence, openTask, state.events, state.tasks, state.alarmClocks]);

  const moveOccurrence = useCallback(
    (occ: Occurrence, newStart: number, newEnd: number) => {
      const ev = occ.event;
      if (calById.get(ev.calendarId)?.readOnly) return; // read-only links can't be edited
      let updated: EventItem;
      if (ev.recurrence) {
        // shift the whole series by the same delta (occurrence-level moves
        // would need per-instance overrides; series shift matches intent for
        // "this meeting moved half an hour")
        const delta = newStart - occ.start;
        updated = {
          ...ev,
          start: ev.start + delta,
          end: ev.end + delta + (newEnd - newStart - (occ.end - occ.start)),
        };
      } else {
        updated = { ...ev, start: newStart, end: newEnd };
      }
      dispatch({ type: 'event/move', id: ev.id, start: updated.start, end: updated.end });
      pushToGoogle(updated, 'upsert');
    },
    [dispatch, calById, pushToGoogle],
  );

  const saveEvent = useCallback(
    (ev: EventItem) => {
      const previous = state.events.find((e) => e.id === ev.id);
      // moved to another calendar → remove from the old Google calendar
      if (previous && previous.calendarId !== ev.calendarId) {
        pushToGoogle(previous, 'delete');
        ev = { ...ev, googleEventId: undefined };
      }
      if (editor?.isNew) dispatch({ type: 'event/add', event: ev });
      else dispatch({ type: 'event/update', event: ev });
      pushToGoogle(ev, 'upsert');
      setEditor(null);
    },
    [dispatch, editor, state.events, pushToGoogle],
  );

  const deleteFromPopover = useCallback(
    (mode: 'occurrence' | 'series') => {
      if (!popover) return;
      const ev = popover.occ.event;
      if (mode === 'occurrence') {
        dispatch({ type: 'event/except', id: ev.id, occStart: popover.occ.start });
        pushToGoogle(
          { ...ev, exceptions: [...(ev.exceptions ?? []), popover.occ.start] },
          'upsert',
        );
      } else {
        dispatch({ type: 'event/delete', id: ev.id });
        pushToGoogle(ev, 'delete');
      }
      setPopover(null);
    },
    [dispatch, popover, pushToGoogle],
  );

  /* keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && createMenuOpen) {
        setCreateMenuOpen(false);
        return;
      }
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        editor ||
        taskEditor ||
        alarmEditor ||
        settingsOpen ||
        googleOpen ||
        calEditor ||
        drawerOpen ||
        createMenuOpen
      )
        return;
      switch (e.key) {
        case 't':
        case 'T':
          navigate(0);
          break;
        case 'd':
        case 'D':
          setView('day');
          break;
        case 'w':
        case 'W':
          setView('week');
          break;
        case 'm':
        case 'M':
          setView('month');
          break;
        case 'a':
        case 'A':
          setView('schedule');
          break;
        case 'x':
        case 'X':
          setView('3day');
          break;
        case 'c':
        case 'C':
          openCreate();
          break;
        case 'ArrowLeft':
        case 'k':
          navigate(-1);
          break;
        case 'ArrowRight':
        case 'j':
          navigate(1);
          break;
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, openCreate, editor, taskEditor, alarmEditor, settingsOpen, googleOpen, calEditor, drawerOpen, createMenuOpen]);

  const popoverCal = popover
    ? allCalendars.find((c) => c.id === popover.occ.event.calendarId)
    : undefined;

  const desktopContentKey = desktopTab === 'today' ? 'today' : `calendar-${view}-${rangeStart}`;

  const gridAndMonth = (
    <>
      {view === 'month' ? (
        <MonthView
          date={date}
          occurrences={occurrences}
          tasks={taskOccurrences}
          calendars={allCalendars}
          weekStartsOn={state.settings.weekStartsOn}
          onEventClick={openEventPopover}
          onTaskClick={openTask}
          onDayClick={(day) => openCreate(day.getTime() + 9 * 3_600_000, day.getTime() + 10 * 3_600_000)}
          onDayNumberClick={(day) => {
            setDate(day);
            setView('day');
          }}
        />
      ) : (
        <TimeGrid
          days={days}
          occurrences={occurrences}
          tasks={taskOccurrences}
          calendars={allCalendars}
          onCreate={(start, end) => openCreate(start, end)}
          onEventClick={openEventPopover}
          onToggleTask={toggleTask}
          onTaskClick={openTask}
          onMoveOccurrence={moveOccurrence}
          onDayHeadClick={(day) => {
            setDate(day);
            setView('day');
          }}
        />
      )}
    </>
  );

  return (
    <div className="app">
      {isMobile ? (
        <>
          {tab === 'calendar' && (
            <MobileTopBar
              view={view}
              date={date}
              busyDays={busyDays}
              onOpenDrawer={() => {
                setCreateMenuOpen(false);
                setDrawerOpen(true);
              }}
              onSelectDate={(d) => setDate(startOfDay(d))}
              onOpenOccurrence={(occ) => openOccurrence(occ)}
              onJumpToday={() => {
                navigate(0);
                setJumpSignal((j) => j + 1);
              }}
            />
          )}
          <main className="main mobile-main">
            {tab === 'today' && (
              <TodayView
                occurrences={agendaOccurrences}
                tasks={agendaTasks}
                calendars={allCalendars}
                onEventClick={openEventPopover}
                onToggleTask={toggleTask}
                onTaskClick={openTask}
              />
            )}
            {tab === 'calendar' && view === 'schedule' && (
              <AgendaView
                occurrences={agendaOccurrences}
                tasks={agendaTasks}
                calendars={allCalendars}
                onEventClick={openEventPopover}
                onToggleTask={toggleTask}
                onTaskClick={openTask}
                weekStartsOn={state.settings.weekStartsOn}
                jumpSignal={jumpSignal}
              />
            )}
            {tab === 'alarms' && (
              <AlarmsView
                alarms={state.alarmClocks}
                onCreate={(alarm) => dispatch({ type: 'alarm/add', alarm })}
                onToggle={(alarm, enabled) =>
                  dispatch({
                    type: 'alarm/setEnabled',
                    id: alarm.id,
                    enabled,
                    // re-enabling a one-time alarm re-aims it at the next occurrence
                    anchor:
                      enabled && !alarm.repeatDays.length
                        ? nextAlarmMoment(alarm.hour, alarm.minute, Date.now())
                        : undefined,
                  })
                }
                onEdit={(alarm) => setAlarmEditor({ alarm, mode: 'full' })}
                onEditOptions={(alarm) => setAlarmEditor({ alarm, mode: 'options' })}
                onDelete={(id) => dispatch({ type: 'alarm/delete', id })}
              />
            )}
            {tab === 'timers' && (
              <TimersView
                timers={state.timers}
                onStart={(timer) => dispatch({ type: 'timer/start', timer })}
                onCancel={(id) => dispatch({ type: 'timer/cancel', id })}
                onPause={(id, remaining) => dispatch({ type: 'timer/pause', id, remaining })}
                onResume={(id, endAt) => dispatch({ type: 'timer/resume', id, endAt })}
              />
            )}
            {tab === 'calendar' && view === 'month' && gridAndMonth}
            {tab === 'calendar' && view !== 'schedule' && view !== 'month' && (
              <SwipeViews
                periodKey={days[0]?.getTime() ?? 0}
                onNavigate={(dir) => navigate(dir)}
                renderPanel={(offset) => {
                  const panelDays = days.map((d) => addDays(d, offset * spanDays));
                  return (
                    <TimeGrid
                      key={panelDays[0].getTime()}
                      days={panelDays}
                      occurrences={occurrences}
                      tasks={taskOccurrences}
                      calendars={allCalendars}
                      onCreate={(start, end) => openCreate(start, end)}
                      onEventClick={openEventPopover}
                      onToggleTask={toggleTask}
                      onTaskClick={openTask}
                      onMoveOccurrence={moveOccurrence}
                      onDayHeadClick={(day) => {
                        setDate(day);
                        setView('day');
                      }}
                    />
                  );
                }}
              />
            )}
          </main>
          {createMenuOpen && (
            <button
              className="create-menu-scrim"
              aria-label="Close create menu"
              onClick={() => setCreateMenuOpen(false)}
            />
          )}
          {/* the hour grid (alarms) and timer grid are their own creation
              UIs — no FAB on those tabs */}
          {tab !== 'timers' && tab !== 'alarms' && (
            <div className={`fab-cluster${createMenuOpen ? ' is-open' : ''}`}>
              {createMenuOpen && (
                <div className="fab-actions" role="menu" aria-label="Create">
                  <button role="menuitem" onClick={() => openCreateTask()}>
                    <TaskIcon size={22} />
                    Task
                  </button>
                  <button role="menuitem" onClick={() => openCreate()}>
                    <CalIcon size={22} />
                    Event
                  </button>
                </div>
              )}
              <button
                className={`fab${createMenuOpen ? ' is-open' : ''}`}
                aria-label={createMenuOpen ? 'Close create menu' : 'Create new'}
                aria-expanded={createMenuOpen}
                onClick={() => setCreateMenuOpen((open) => !open)}
              >
                <Plus size={22} />
              </button>
            </div>
          )}
          <MobileTabBar
            tab={tab}
            onTab={(t) => {
              setCreateMenuOpen(false);
              setPopover(null);
              setTab(t);
            }}
          />
          <MenuDrawer
            open={drawerOpen}
            view={view}
            onClose={() => setDrawerOpen(false)}
            onView={(v) => {
              setPopover(null);
              setView(v);
            }}
            onEditCalendar={(cal) => setCalEditor({ cal })}
            onOpenGoogle={() => setGoogleOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </>
      ) : (
        <>
          <TopBar
            view={view}
            tab={desktopTab}
            date={date}
            onView={(v) => {
              setPopover(null);
              setView(v);
            }}
            onTab={(nextTab) => {
              setPopover(null);
              setDesktopTab(nextTab);
            }}
            onNavigate={navigate}
            onCreate={() => openCreate()}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenNextAlarm={openNextAlarm}
            nextAlarm={nextAlarm}
          />
          <div className="body">
            <Sidebar
              selected={date}
              onSelectDate={(d) => {
                setDate(startOfDay(d));
                if (view === 'month') setView('day');
              }}
              onCreate={() => openCreate()}
              onEditCalendar={(cal) => setCalEditor({ cal })}
              onOpenGoogle={() => setGoogleOpen(true)}
              onOpenOccurrence={(occ) => openOccurrence(occ)}
              busyDays={busyDays}
              searchRef={searchRef}
            />
            <main className="main">
              <div
                key={desktopContentKey}
                className="desktop-view-transition"
                style={{ ['--desktop-view-dir' as any]: desktopTransitionDir }}
              >
                {desktopTab === 'today' ? (
                  <TodayView
                    occurrences={agendaOccurrences}
                    tasks={agendaTasks}
                    calendars={allCalendars}
                    onEventClick={openEventPopover}
                    onToggleTask={toggleTask}
                    onTaskClick={openTask}
                  />
                ) : view === 'schedule' ? (
                  <AgendaView
                    occurrences={agendaOccurrences}
                    tasks={agendaTasks}
                    calendars={allCalendars}
                    onEventClick={openEventPopover}
                    onToggleTask={toggleTask}
                    onTaskClick={openTask}
                    weekStartsOn={state.settings.weekStartsOn}
                    jumpSignal={jumpSignal}
                  />
                ) : (
                  gridAndMonth
                )}
              </div>
            </main>
          </div>
        </>
      )}

      {popover && (
        <EventPopover
          occ={popover.occ}
          anchor={popover.anchor}
          calendar={popoverCal}
          onClose={() => setPopover(null)}
          onEdit={() => {
            setEditor({ draft: { ...popover.occ.event }, isNew: false });
            setPopover(null);
          }}
          onDelete={deleteFromPopover}
        />
      )}

      {editor &&
        (() => {
          // mobile gets the Google iOS-style sheet with inline pickers;
          // desktop keeps the classic form editor
          const editorProps = {
            draft: editor.draft,
            isNew: editor.isNew,
            onSave: saveEvent,
            onDelete: editor.isNew
              ? undefined
              : () => {
                  dispatch({ type: 'event/delete', id: editor.draft.id });
                  pushToGoogle(editor.draft, 'delete');
                  setEditor(null);
                },
            onClose: () => setEditor(null),
            onSwitchToTask: editor.isNew
              ? () => {
                  const at = editor.draft.start;
                  setEditor(null);
                  openCreateTask(at);
                }
              : undefined,
          };
          return isMobile ? <EventSheet {...editorProps} /> : <EventEditor {...editorProps} />;
        })()}

      {taskEditor && (
        <TaskEditor
          draft={taskEditor.draft}
          isNew={taskEditor.isNew}
          onSave={saveTask}
          onDelete={
            taskEditor.isNew
              ? undefined
              : () => {
                  dispatch({ type: 'task/delete', id: taskEditor.draft.id });
                  setTaskEditor(null);
                }
          }
          onClose={() => setTaskEditor(null)}
          onSwitchToEvent={
            taskEditor.isNew
              ? () => {
                  const at = taskEditor.draft.due;
                  setTaskEditor(null);
                  openCreate(at + 9 * 3_600_000 * Number(!taskEditor.draft.hasTime));
                }
              : undefined
          }
        />
      )}

      {alarmEditor && (
        <AlarmEditor
          alarm={alarmEditor.alarm}
          mode={alarmEditor.mode}
          onSave={(alarm) => {
            dispatch({ type: 'alarm/update', alarm });
            setAlarmEditor(null);
          }}
          onDelete={(id) => {
            dispatch({ type: 'alarm/delete', id });
            setAlarmEditor(null);
          }}
          onClose={() => setAlarmEditor(null)}
        />
      )}

      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} onOpenGoogle={() => setGoogleOpen(true)} />
      )}
      {googleOpen && <GoogleConnectModal onClose={() => setGoogleOpen(false)} />}
      {calEditor && <CalendarEditor calendar={calEditor.cal} onClose={() => setCalEditor(null)} />}

      <AlarmOverlay
        alarms={ringing}
        alarmSound={state.settings.alarmSound}
        onDismiss={dismissRinging}
        onSnooze={snooze}
      />
    </div>
  );
}
