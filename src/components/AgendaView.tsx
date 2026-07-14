import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { CalendarInfo, Occurrence, TaskOccurrence } from '../types';
import { MS_DAY, addDays, fmtTime, fmtWeekdayShort, isToday, startOfDay, startOfWeek } from '../lib/dates';
import { RingingBell } from './icons';

/** Google iOS-style week separator: "JULY 13 – 19" or "JUL 28 – AUG 3" */
function weekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const m1 = weekStart.toLocaleDateString('en-GB', { month: 'long' });
  if (weekStart.getMonth() === end.getMonth()) {
    return `${m1} ${weekStart.getDate()} – ${end.getDate()}`;
  }
  const s1 = weekStart.toLocaleDateString('en-GB', { month: 'short' });
  const s2 = end.toLocaleDateString('en-GB', { month: 'short' });
  return `${s1} ${weekStart.getDate()} – ${s2} ${end.getDate()}`;
}

interface Props {
  occurrences: Occurrence[];
  tasks: TaskOccurrence[];
  calendars: CalendarInfo[];
  onEventClick: (occ: Occurrence, anchor: DOMRect) => void;
  onToggleTask: (occ: TaskOccurrence) => void;
  onTaskClick: (occ: TaskOccurrence) => void;
  weekStartsOn: 0 | 1;
  /** bump this to scroll back to today (e.g. tapping the "today" glyph) */
  jumpSignal: number;
}

interface DayGroup {
  day: Date;
  items: Occurrence[];
  taskItems: TaskOccurrence[];
}

/**
 * Google Calendar's "Schedule" view: a single scrolling list grouped by
 * calendar day, days with no events skipped entirely. Multi-day / all-day
 * events render as outlined pills that repeat on every day they touch;
 * timed events render as solid colour cards.
 */
export function AgendaView({
  occurrences,
  tasks,
  calendars,
  onEventClick,
  onToggleTask,
  onTaskClick,
  weekStartsOn,
  jumpSignal,
}: Props) {
  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayAnchorRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<number, Occurrence[]>();
    for (const occ of occurrences) {
      let d = startOfDay(occ.start).getTime();
      const last = startOfDay(Math.max(occ.end - 1, occ.start)).getTime();
      while (d <= last) {
        (map.get(d) ?? map.set(d, []).get(d)!).push(occ);
        d += MS_DAY;
      }
    }
    const taskMap = new Map<number, TaskOccurrence[]>();
    for (const occ of tasks) {
      const d = startOfDay(occ.due).getTime();
      if (!map.has(d)) map.set(d, []);
      (taskMap.get(d) ?? taskMap.set(d, []).get(d)!).push(occ);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, items]) => ({
        day: new Date(t),
        items: items.sort((a, b) => {
          const aSpan = Number(a.event.allDay || a.end - a.start >= MS_DAY);
          const bSpan = Number(b.event.allDay || b.end - b.start >= MS_DAY);
          return bSpan - aSpan || a.start - b.start;
        }),
        taskItems: (taskMap.get(t) ?? []).sort(
          (a, b) => Number(a.completed) - Number(b.completed) || a.due - b.due,
        ),
      }));
  }, [occurrences, tasks]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const anchor = todayAnchorRef.current;
    if (!scroller || !anchor) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior =
      didInitialScrollRef.current && !prefersReducedMotion ? 'smooth' : 'auto';
    const scrollerRect = scroller.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const top = scroller.scrollTop + anchorRect.top - scrollerRect.top;

    didInitialScrollRef.current = true;
    scroller.scrollTo({
      top: Math.max(top, 0),
      behavior,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpSignal]);

  if (groups.length === 0) {
    return (
      <div className="agenda-empty">
        <p>No events here yet.</p>
      </div>
    );
  }

  return (
    <div className="agenda-scroll" ref={scrollRef}>
      {groups.map(({ day, items, taskItems }, gi) => {
        const today = isToday(day);
        // Google iOS labels each new week between the day groups — empty
        // days are skipped, so compare weeks rather than checking Mondays
        const week = startOfWeek(day, weekStartsOn);
        const showWeekLabel =
          gi > 0 && week.getTime() !== startOfWeek(groups[gi - 1].day, weekStartsOn).getTime();
        return (
          <Fragment key={day.getTime()}>
            {showWeekLabel && <div className="agenda-week-label">{weekLabel(week)}</div>}
            {today && <div className="agenda-today-anchor" ref={todayAnchorRef} aria-hidden="true" />}
            <div className={`agenda-day${today ? ' is-today' : ''}`}>
              <div className="agenda-daylabel">
                <span className="agenda-dow">{fmtWeekdayShort(day).toUpperCase()}</span>
                <span className="agenda-datenum">{day.getDate()}</span>
              </div>
              <div className="agenda-items">
                {items.map((occ) => {
                  const cal = calById.get(occ.event.calendarId);
                  const color = occ.event.color ?? cal?.color ?? 'var(--accent)';
                  const isMultiDay = occ.event.allDay || occ.end - occ.start >= MS_DAY;
                  const dayStart = day.getTime();
                  const spanStart = startOfDay(occ.start).getTime();
                  const spanEnd = startOfDay(Math.max(occ.end - 1, occ.start)).getTime();
                  const isLastDay = dayStart >= spanEnd;
                  const totalDays = Math.round((spanEnd - spanStart) / MS_DAY) + 1;
                  const dayIndex = Math.round((dayStart - spanStart) / MS_DAY) + 1;

                  let meta: string;
                  if (isMultiDay) {
                    if (isLastDay && !occ.event.allDay) {
                      meta = `Until ${fmtTime(occ.end)}${occ.event.location ? ` at ${occ.event.location}` : ''}`;
                    } else {
                      meta = occ.event.allDay ? (totalDays > 1 ? '' : 'All day') : `${fmtTime(occ.start)} –`;
                    }
                  } else {
                    meta = `${fmtTime(occ.start)} – ${fmtTime(occ.end)}${occ.event.location ? ` · ${occ.event.location}` : ''}`;
                  }

                  return (
                    <button
                      key={occ.key + dayStart}
                      className={`agenda-card${isMultiDay ? ' is-outline' : ''}`}
                      style={{ ['--ev' as any]: color }}
                      onClick={(e) => onEventClick(occ, (e.currentTarget as HTMLElement).getBoundingClientRect())}
                    >
                      <span className="agenda-card-title">
                        <span className="agenda-card-title-text">{occ.event.title || '(untitled)'}</span>
                        {occ.event.alarms.length > 0 && !occ.event.allDay && <RingingBell size={11} />}
                        {isMultiDay && totalDays > 1 && (
                          <span className="agenda-daycount">
                            Day {dayIndex}/{totalDays}
                          </span>
                        )}
                      </span>
                      {meta && <span className="agenda-card-meta">{meta}</span>}
                    </button>
                  );
                })}

                {taskItems.map((occ) => {
                  const cal = calById.get(occ.task.calendarId);
                  const color = cal?.color ?? 'var(--accent)';
                  return (
                    <div key={occ.key} className={`task-row${occ.completed ? ' is-done' : ''}`}>
                      <button
                        className="task-check"
                        style={{ ['--ev' as any]: color }}
                        aria-label={occ.completed ? 'Mark as not done' : 'Mark as done'}
                        aria-pressed={occ.completed}
                        onClick={() => onToggleTask(occ)}
                      >
                        {occ.completed && '✓'}
                      </button>
                      <button className="task-row-body" onClick={() => onTaskClick(occ)}>
                        <span className="task-row-title">{occ.task.title || '(untitled)'}</span>
                        <span className="task-row-meta">
                          {occ.task.hasTime && <span className="task-time">{fmtTime(occ.due)}</span>}
                          {occ.task.recurrence && <span aria-label="repeats">↻</span>}
                          {occ.task.alarms.length > 0 && occ.task.hasTime && (
                            <RingingBell size={10} />
                          )}
                          <span className="task-list-name" style={{ color }}>
                            {cal?.name}
                          </span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            {today && (
              <div className="agenda-now-divider" aria-hidden="true">
                <span className="agenda-now-dot" />
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
