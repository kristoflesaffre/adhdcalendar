import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarInfo, EventItem, Occurrence, TaskItem, TaskOccurrence, ViewMode } from '../src/types';
import { useStore, draftEvent } from './state/store';
import { expandEvents, expandTasks } from './lib/recurrence';
import {
  MS_DAY,
  addDays,
  addMonths,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from './lib/dates';
import { useAlarmEngine } from './alarm/engine';
import { AlarmOverlay } from './alarm/AlarmOverlay';
import { ensureAudioUnlocked } from './alarm/sound';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { MonthView } from './components/MonthView';
import { TimeGrid } from './components/TimeGrid';
import { AgendaView } from './components/AgendaView';
import { TodayView } from './components/TodayView';
import { MobileTopBar } from './components/MobileTopBar';
import { MobileTabBar } from './components/MobileTabBar';
import type { MobileTab } from './components/MobileTabBar';
import { MenuDrawer } from './components/MenuDrawer';
import { SwipeViews } from './components/SwipeViews';
import { EventEditor } from './components/EventEditor';
import { TaskEditor, draftTask } from './components/TaskEditor';
import { EventPopover } from './components/EventPopover';
import { SettingsModal } from './components/SettingsModal';
import { GoogleConnectModal } from './components/GoogleConnectModal';
import { CalendarEditor } from './components/CalendarEditor';
import { Plus } from './components/icons';
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
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [taskEditor, setTaskEditor] = useState<TaskEditorState | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [googleOpen, setGoogleOpen] = useState(false);
  const [calEditor, setCalEditor] = useState<{ cal: CalendarInfo | null } | null>(null);
  const [tab, setTab] = useState<MobileTab>('today');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [jumpSignal, setJumpSignal] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const { ringing, dismiss, snooze, nextAlarm } = useAlarmEngine(state);

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

  /* the desktop grid has no Schedule or 3-Day — fall back to Week if the
     window grows past the mobile breakpoint while one was active */
  useEffect(() => {
    if (!isMobile && (view === 'schedule' || view === '3day')) setView('week');
  }, [isMobile, view]);

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
          const parsed = parseIcs(text, state.settings.defaultAlarms);
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
          const events = await fetchGoogleEvents(token, cal.googleId!, cal.id, state.settings.defaultAlarms);
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

  /* keep the iOS home-screen widget in sync */
  useEffect(() => {
    scheduleWidgetUpdate(state);
  }, [state]);

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
    () => new Set(state.calendars.filter((c) => c.visible).map((c) => c.id)),
    [state.calendars],
  );

  const occurrences = useMemo(
    () => expandEvents(state.events, visibleIds, rangeStart - swipePad, rangeEnd + swipePad),
    [state.events, visibleIds, rangeStart, rangeEnd, swipePad],
  );

  /* the mobile Schedule view scrolls through real time, not the nav date */
  const agendaOccurrences = useMemo(() => {
    const now = Date.now();
    return expandEvents(state.events, visibleIds, now - 3 * MS_DAY, now + 180 * MS_DAY);
  }, [state.events, visibleIds]);

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
      setPopover(null);
      setEditor(null);
      setTaskEditor({ draft: draftTask(firstWritable.id, at), isNew: true });
    },
    [state.calendars],
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
    for (const occ of expandEvents(state.events, visibleIds, s, e)) {
      set.add(dayKey(new Date(occ.start)));
    }
    return set;
  }, [state.events, visibleIds, date]);

  const navigate = useCallback(
    (dir: -1 | 0 | 1) => {
      setPopover(null);
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
      const d = draftEvent(firstWritable.id, state.settings.defaultAlarms, start);
      if (start && end) {
        d.end = end;
      }
      d.allDay = allDay;
      setPopover(null);
      setEditor({ draft: d, isNew: true });
    },
    [state.calendars, state.settings.defaultAlarms],
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
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        editor ||
        taskEditor ||
        settingsOpen ||
        googleOpen ||
        calEditor ||
        drawerOpen
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
  }, [navigate, openCreate, editor, taskEditor, settingsOpen, googleOpen, calEditor, drawerOpen]);

  const popoverCal = popover
    ? state.calendars.find((c) => c.id === popover.occ.event.calendarId)
    : undefined;

  const gridAndMonth = (
    <>
      {view === 'month' ? (
        <MonthView
          date={date}
          occurrences={occurrences}
          tasks={taskOccurrences}
          calendars={state.calendars}
          weekStartsOn={state.settings.weekStartsOn}
          onEventClick={(occ, anchor) => setPopover({ occ, anchor })}
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
          calendars={state.calendars}
          onCreate={(start, end) => openCreate(start, end)}
          onEventClick={(occ, anchor) => setPopover({ occ, anchor })}
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
              onOpenDrawer={() => setDrawerOpen(true)}
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
                calendars={state.calendars}
                onEventClick={(occ, anchor) => setPopover({ occ, anchor })}
                onToggleTask={toggleTask}
                onTaskClick={openTask}
              />
            )}
            {tab === 'calendar' && view === 'schedule' && (
              <AgendaView
                occurrences={agendaOccurrences}
                tasks={agendaTasks}
                calendars={state.calendars}
                onEventClick={(occ, anchor) => setPopover({ occ, anchor })}
                onToggleTask={toggleTask}
                onTaskClick={openTask}
                jumpSignal={jumpSignal}
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
                      calendars={state.calendars}
                      onCreate={(start, end) => openCreate(start, end)}
                      onEventClick={(occ, anchor) => setPopover({ occ, anchor })}
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
          <button className="fab" aria-label="New event" onClick={() => openCreate()}>
            <Plus size={22} />
          </button>
          <MobileTabBar
            tab={tab}
            onTab={(t) => {
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
            date={date}
            onView={(v) => {
              setPopover(null);
              setView(v);
            }}
            onNavigate={navigate}
            onCreate={() => openCreate()}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenOccurrence={(occ) => openOccurrence(occ)}
            nextAlarm={nextAlarm}
            searchRef={searchRef}
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
              busyDays={busyDays}
            />
            <main className="main">{gridAndMonth}</main>
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

      {editor && (
        <EventEditor
          draft={editor.draft}
          isNew={editor.isNew}
          onSave={saveEvent}
          onDelete={
            editor.isNew
              ? undefined
              : () => {
                  dispatch({ type: 'event/delete', id: editor.draft.id });
                  pushToGoogle(editor.draft, 'delete');
                  setEditor(null);
                }
          }
          onClose={() => setEditor(null)}
          onSwitchToTask={
            editor.isNew
              ? () => {
                  const at = editor.draft.start;
                  setEditor(null);
                  openCreateTask(at);
                }
              : undefined
          }
        />
      )}

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

      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} onOpenGoogle={() => setGoogleOpen(true)} />
      )}
      {googleOpen && <GoogleConnectModal onClose={() => setGoogleOpen(false)} />}
      {calEditor && <CalendarEditor calendar={calEditor.cal} onClose={() => setCalEditor(null)} />}

      <AlarmOverlay
        alarms={ringing}
        alarmSound={state.settings.alarmSound}
        onDismiss={dismiss}
        onSnooze={snooze}
      />
    </div>
  );
}
