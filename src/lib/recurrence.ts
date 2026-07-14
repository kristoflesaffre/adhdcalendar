import type { EventItem, Occurrence, Recurrence, TaskItem, TaskOccurrence } from '../types';
import { MS_DAY, addDays, addMonths, daysInMonth, startOfDay } from './dates';

const MAX_ITERATIONS = 1500;

function occurrenceKey(eventId: string, start: number): string {
  return `${eventId}@${start}`;
}

function makeOccurrence(event: EventItem, start: number): Occurrence {
  const duration = event.end - event.start;
  return { event, start, end: start + duration, key: occurrenceKey(event.id, start) };
}

/**
 * Expand an event into concrete occurrences overlapping [rangeStart, rangeEnd).
 * Handles non-recurring events, DAILY/WEEKLY/MONTHLY/YEARLY rules with
 * interval, BYDAY (weekly), UNTIL, COUNT, and per-occurrence exceptions.
 */
export function expandEvent(event: EventItem, rangeStart: number, rangeEnd: number): Occurrence[] {
  const duration = Math.max(event.end - event.start, 0);
  const rule = event.recurrence;
  const exceptions = new Set(event.exceptions ?? []);

  if (!rule) {
    if (event.start < rangeEnd && event.end > rangeStart && !exceptions.has(event.start)) {
      return [makeOccurrence(event, event.start)];
    }
    return [];
  }

  const out: Occurrence[] = [];
  const interval = Math.max(1, rule.interval || 1);
  const until = rule.until ?? Infinity;
  const maxCount = rule.count ?? Infinity;
  let produced = 0;

  const push = (start: number): boolean => {
    // returns false when past the range/limits and iteration should stop
    if (start > until) return false;
    produced++;
    if (produced > maxCount) return false;
    if (start >= rangeEnd) return false;
    if (start + duration > rangeStart && !exceptions.has(start)) {
      out.push(makeOccurrence(event, start));
    }
    return true;
  };

  if (rule.freq === 'DAILY') {
    let cursor = new Date(event.start);
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (!push(cursor.getTime())) break;
      cursor = addDays(cursor, interval);
    }
    return out;
  }

  if (rule.freq === 'WEEKLY') {
    const byDay =
      rule.byDay && rule.byDay.length > 0 ? [...rule.byDay].sort() : [new Date(event.start).getDay()];
    const anchor = new Date(event.start);
    const minutes = anchor.getHours() * 60 + anchor.getMinutes();
    // week containing the first occurrence, starting Sunday for BYDAY math
    let weekStart = startOfDay(anchor);
    weekStart = addDays(weekStart, -weekStart.getDay());
    for (let w = 0; w < MAX_ITERATIONS; w++) {
      for (const dow of byDay) {
        const day = addDays(weekStart, dow);
        day.setMinutes(minutes);
        const t = day.getTime();
        if (t < event.start) continue;
        if (!push(t)) return out;
      }
      if (weekStart.getTime() > rangeEnd + MS_DAY * 7) break;
      weekStart = addDays(weekStart, 7 * interval);
    }
    return out;
  }

  if (rule.freq === 'MONTHLY') {
    const anchor = new Date(event.start);
    const dayOfMonth = anchor.getDate();
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const base = addMonths(startOfDay(anchor), i * interval);
      // skip months that don't have this day (e.g. 31st)
      if (daysInMonth(base.getFullYear(), base.getMonth()) < dayOfMonth) continue;
      const d = new Date(
        base.getFullYear(),
        base.getMonth(),
        dayOfMonth,
        anchor.getHours(),
        anchor.getMinutes(),
      );
      if (!push(d.getTime())) break;
      if (d.getTime() >= rangeEnd) break;
    }
    return out;
  }

  // YEARLY
  const anchor = new Date(event.start);
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const year = anchor.getFullYear() + i * interval;
    if (anchor.getMonth() === 1 && anchor.getDate() === 29 && daysInMonth(year, 1) < 29) continue;
    const d = new Date(year, anchor.getMonth(), anchor.getDate(), anchor.getHours(), anchor.getMinutes());
    if (!push(d.getTime())) break;
    if (d.getTime() >= rangeEnd) break;
  }
  return out;
}

/** Expand many events, filtered to visible calendars, sorted by start */
export function expandEvents(
  events: EventItem[],
  visibleCalendarIds: Set<string>,
  rangeStart: number,
  rangeEnd: number,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) {
    if (!visibleCalendarIds.has(ev.calendarId)) continue;
    out.push(...expandEvent(ev, rangeStart, rangeEnd));
  }
  out.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  return out;
}

/**
 * Expand tasks (incl. recurring ones) into per-day occurrences within
 * [rangeStart, rangeEnd), reusing the event expansion by treating each
 * task as a zero-length pseudo-event at its due moment.
 */
export function expandTasks(
  tasks: TaskItem[],
  visibleCalendarIds: Set<string>,
  rangeStart: number,
  rangeEnd: number,
): TaskOccurrence[] {
  const out: TaskOccurrence[] = [];
  for (const task of tasks) {
    if (!visibleCalendarIds.has(task.calendarId)) continue;
    const pseudo = {
      id: task.id,
      calendarId: task.calendarId,
      title: task.title,
      start: task.due,
      end: task.due + 1,
      allDay: !task.hasTime,
      recurrence: task.recurrence,
      exceptions: task.exceptions,
      notifications: task.notifications,
      alarms: task.alarms,
    } as EventItem;
    for (const occ of expandEvent(pseudo, rangeStart, rangeEnd)) {
      out.push({
        task,
        due: occ.start,
        key: `${task.id}@${occ.start}`,
        completed: task.completedOn?.includes(occ.start) ?? false,
      });
    }
  }
  out.sort((a, b) => a.due - b.due);
  return out;
}

export function describeRecurrence(r: Recurrence | undefined): string {
  if (!r) return 'Does not repeat';
  const every = r.interval > 1 ? `Every ${r.interval} ` : 'Every ';
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (r.freq) {
    case 'DAILY':
      return r.interval > 1 ? `${every}days` : 'Daily';
    case 'WEEKLY': {
      const days = r.byDay && r.byDay.length ? ` on ${r.byDay.map((d) => DOW[d]).join(', ')}` : '';
      return (r.interval > 1 ? `${every}weeks` : 'Weekly') + days;
    }
    case 'MONTHLY':
      return r.interval > 1 ? `${every}months` : 'Monthly';
    case 'YEARLY':
      return r.interval > 1 ? `${every}years` : 'Yearly';
  }
}
