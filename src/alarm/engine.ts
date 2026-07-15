import { useEffect, useRef, useState } from 'react';
import type { AppState, Occurrence, RingingAlarm, Snooze } from '../types';
import { MS_DAY, MS_MIN, fmtOffset } from '../lib/dates';
import { expandEvents, expandTasks } from '../lib/recurrence';
import { syncNativeAlarms } from '../native/alarms';
import type { StandardNotificationLike } from '../native/alarms';
import { armNativeRing, ringNativeAlarm, startBackgroundKeepAlive } from '../native/alarmAudio';

const FIRED_KEY = 'carillon.fired.v1';
const SNOOZE_KEY = 'carillon.snoozes.v1';
const TICK_MS = 5_000;
/** an alarm still fires if we were away, up to this long after its moment */
const LATE_WINDOW = 15 * MS_MIN;
// Keep native alarm fallbacks scheduled well beyond the next app launch.
// A two-day window left later events unprotected when iOS suspended the app.
const LOOKAHEAD = 67 * MS_DAY;
const NOTIFICATION_LOOKAHEAD = 67 * MS_DAY;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

interface PendingAlarm {
  key: string;
  triggerAt: number;
  base: Omit<RingingAlarm, 'firedAt' | 'snoozed'>;
  snoozed?: boolean;
}

function computePending(state: AppState, now: number): PendingAlarm[] {
  const visible = new Set(state.calendars.map((c) => c.id)); // alarms ring even for hidden calendars? No — all calendars: an alarm is a commitment
  const occs: Occurrence[] = expandEvents(state.events, visible, now - LATE_WINDOW, now + LOOKAHEAD);
  const calById = new Map(state.calendars.map((c) => [c.id, c]));
  const out: PendingAlarm[] = [];

  for (const occ of occs) {
    if (occ.event.allDay) continue;
    const cal = calById.get(occ.event.calendarId);
    // key on the Google id when present: pulls re-import events with fresh
    // local ids, and a dismissed alarm must stay dismissed across a sync
    const stableId = occ.event.googleEventId ?? occ.event.id;
    for (const minutes of occ.event.alarms ?? []) {
      const triggerAt = occ.start - minutes * MS_MIN;
      const key = `${stableId}@${occ.start}@${minutes}`;
      out.push({
        key,
        triggerAt,
        base: {
          key,
          eventId: occ.event.id,
          title: occ.event.title || '(untitled)',
          calendarName: cal?.name ?? '',
          color: occ.event.color ?? cal?.color ?? '#206657',
          occStart: occ.start,
          minutesBefore: minutes,
          location: occ.event.location,
        },
      });
    }
  }

  // timed, unchecked tasks ring exactly like events
  const taskOccs = expandTasks(state.tasks, visible, now - LATE_WINDOW, now + LOOKAHEAD);
  for (const occ of taskOccs) {
    if (!occ.task.hasTime || occ.completed) continue;
    const cal = calById.get(occ.task.calendarId);
    for (const minutes of occ.task.alarms ?? []) {
      const triggerAt = occ.due - minutes * MS_MIN;
      const key = `task:${occ.task.id}@${occ.due}@${minutes}`;
      out.push({
        key,
        triggerAt,
        base: {
          key,
          eventId: occ.task.id,
          title: occ.task.title || '(untitled)',
          calendarName: cal?.name ?? '',
          color: cal?.color ?? '#206657',
          occStart: occ.due,
          minutesBefore: minutes,
        },
      });
    }
  }

  // running countdown timers ring exactly like alarms (paused ones don't)
  for (const timer of state.timers ?? []) {
    if (timer.pausedRemaining != null) continue;
    const key = `timer:${timer.id}@${timer.endAt}`;
    out.push({
      key,
      triggerAt: timer.endAt,
      base: {
        key,
        eventId: timer.id,
        title: `⏱ ${timer.label}`,
        calendarName: 'Timer',
        color: '#e07b39',
        occStart: timer.endAt,
        minutesBefore: 0,
      },
    });
  }

  // active snoozes join the queue
  for (const sn of loadJson<Snooze[]>(SNOOZE_KEY, [])) {
    out.push({ key: sn.key, triggerAt: sn.triggerAt, base: sn.alarm, snoozed: true });
  }

  out.sort((a, b) => a.triggerAt - b.triggerAt);
  return out;
}

function computeStandardNotifications(state: AppState, now: number): StandardNotificationLike[] {
  const calendarIds = new Set(state.calendars.map((calendar) => calendar.id));
  const calendarById = new Map(state.calendars.map((calendar) => [calendar.id, calendar]));
  const occurrences = expandEvents(
    state.events,
    calendarIds,
    now,
    now + NOTIFICATION_LOOKAHEAD,
  );
  const pending: StandardNotificationLike[] = [];

  for (const occurrence of occurrences) {
    const calendar = calendarById.get(occurrence.event.calendarId);
    // Google already delivers its own reminders. Carillon only adds the
    // separate real alarm for those events, avoiding duplicate pushes.
    if (calendar?.source === 'google' || occurrence.event.allDay) continue;
    const stableId = occurrence.event.googleEventId ?? occurrence.event.id;
    for (const minutes of occurrence.event.notifications ?? []) {
      const triggerAt = occurrence.start - minutes * MS_MIN;
      if (triggerAt <= now) continue;
      pending.push({
        key: `notification:${stableId}@${occurrence.start}@${minutes}`,
        triggerAt,
        title: occurrence.event.title || '(untitled)',
        body:
          (minutes === 0 ? 'Starting now' : `Starts in ${fmtOffset(minutes)}`) +
          (occurrence.event.location ? ` · ${occurrence.event.location}` : ''),
      });
    }
  }

  const taskOccurrences = expandTasks(
    state.tasks,
    calendarIds,
    now,
    now + NOTIFICATION_LOOKAHEAD,
  );
  for (const occurrence of taskOccurrences) {
    if (!occurrence.task.hasTime || occurrence.completed) continue;
    for (const minutes of occurrence.task.notifications ?? []) {
      const triggerAt = occurrence.due - minutes * MS_MIN;
      if (triggerAt <= now) continue;
      pending.push({
        key: `notification:task:${occurrence.task.id}@${occurrence.due}@${minutes}`,
        triggerAt,
        title: occurrence.task.title || '(untitled task)',
        body: minutes === 0 ? 'Due now' : `Due in ${fmtOffset(minutes)}`,
      });
    }
  }

  return pending.sort((a, b) => a.triggerAt - b.triggerAt);
}

async function notifySystem(alarm: RingingAlarm): Promise<void> {
  // a system notification as backup when the tab is hidden
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const n = new Notification(`🔔 ${alarm.title}`, {
      body: `${alarm.minutesBefore === 0 ? 'Starting now' : `Starts in ${alarm.minutesBefore} min`}${alarm.location ? ` · ${alarm.location}` : ''}`,
      tag: alarm.key,
      requireInteraction: true,
    });
    n.onclick = () => window.focus();
  } catch {
    // notifications unavailable — the in-app alarm still rings
  }
}

export function useAlarmEngine(state: AppState): {
  ringing: RingingAlarm[];
  dismiss: (key: string) => void;
  snooze: (key: string, minutes: number) => void;
  nextAlarm: PendingAlarm | null;
} {
  const [ringing, setRinging] = useState<RingingAlarm[]>([]);
  const [nextAlarm, setNextAlarm] = useState<PendingAlarm | null>(null);
  const firedRef = useRef<Record<string, number>>(loadJson(FIRED_KEY, {}));
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const pending = computePending(stateRef.current, now);
      const fired = firedRef.current;

      // prune fired entries older than 7 days
      let pruned = false;
      for (const [k, t] of Object.entries(fired)) {
        if (now - t > 7 * MS_DAY) {
          delete fired[k];
          pruned = true;
        }
      }

      const due = pending.filter(
        (p) => p.triggerAt <= now && now - p.triggerAt <= LATE_WINDOW && !(p.key in fired),
      );

      if (due.length) {
        for (const d of due) fired[d.key] = now;
        // consume snoozes that just fired
        const snoozes = loadJson<Snooze[]>(SNOOZE_KEY, []).filter(
          (s) => !due.some((d) => d.key === s.key),
        );
        saveJson(SNOOZE_KEY, snoozes);
        setRinging((cur) => {
          const have = new Set(cur.map((r) => r.key));
          const added = due
            .filter((d) => !have.has(d.key))
            .map((d) => ({ ...d.base, firedAt: now, snoozed: d.snoozed }));
          return added.length ? [...cur, ...added] : cur;
        });
        for (const d of due) void notifySystem({ ...d.base, firedAt: now });
        // backgrounded/locked: the in-app bell can't be heard, so ring
        // through the native background audio session instead
        if (document.hidden) {
          void ringNativeAlarm(stateRef.current.settings.alarmSound, due[0]?.key);
        }
      }
      if (due.length || pruned) saveJson(FIRED_KEY, fired);

      const nextFuture = pending.find((p) => p.triggerAt > now && !(p.key in fired)) ?? null;
      setNextAlarm(nextFuture);
      // keep the NATIVE timer pointed at the next alarm, so a locked phone
      // with a suspended webview still rings on time
      void armNativeRing(
        nextFuture ? nextFuture.triggerAt : null,
        nextFuture ? `🔔 ${nextFuture.base.title}` : undefined,
        nextFuture
          ? (nextFuture.base.minutesBefore === 0
              ? 'Starting now'
              : `Starts in ${nextFuture.base.minutesBefore} min`) +
              (nextFuture.base.location ? ` · ${nextFuture.base.location}` : '') +
              ' — ringing, open the app to stop'
          : undefined,
        stateRef.current.settings.alarmSound,
        nextFuture?.key,
      );
    };

    tick();
    const id = window.setInterval(tick, TICK_MS);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [state]);

  // keep native (iOS) notification chain in sync with upcoming alarms
  useEffect(() => {
    const now = Date.now();
    const pending = computePending(state, now).filter((p) => p.triggerAt > now);
    const standardNotifications = computeStandardNotifications(state, now);
    void syncNativeAlarms(pending, state.settings.alarmSound, standardNotifications);
    // keep the app alive in the background so it can ring for real,
    // rather than relying only on the OS notification chain
    if (pending.length > 0) void startBackgroundKeepAlive();
  }, [state]);

  const dismiss = (key: string) => {
    setRinging((cur) => cur.filter((r) => r.key !== key));
  };

  const snooze = (key: string, minutes: number) => {
    setRinging((cur) => {
      const target = cur.find((r) => r.key === key);
      if (target) {
        const snoozes = loadJson<Snooze[]>(SNOOZE_KEY, []);
        const snKey = `${key}~sn${Date.now()}`;
        const { firedAt: _f, snoozed: _s, ...alarmBase } = target;
        snoozes.push({
          key: snKey,
          triggerAt: Date.now() + minutes * MS_MIN,
          alarm: { ...alarmBase, key: snKey },
        });
        saveJson(SNOOZE_KEY, snoozes);
      }
      return cur.filter((r) => r.key !== key);
    });
  };

  return { ringing, dismiss, snooze, nextAlarm };
}

export type { PendingAlarm };
