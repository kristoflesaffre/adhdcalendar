import { useMemo } from 'react';
import type { CalendarInfo, Occurrence, TaskOccurrence } from '../types';
import { MS_DAY, fmtTime, startOfDay } from '../lib/dates';
import { RingingBell } from './icons';

interface Props {
  occurrences: Occurrence[];
  tasks: TaskOccurrence[];
  calendars: CalendarInfo[];
  onEventClick: (occ: Occurrence, anchor: DOMRect) => void;
  onToggleTask: (occ: TaskOccurrence) => void;
  onTaskClick: (occ: TaskOccurrence) => void;
}

/**
 * Todoist-style "Today" page: big title, a compact block with today's
 * events, then the day's tasks as check-off rows.
 */
export function TodayView({ occurrences, tasks, calendars, onEventClick, onToggleTask, onTaskClick }: Props) {
  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const dayStart = startOfDay(new Date()).getTime();
  const dayEnd = dayStart + MS_DAY;

  const todayEvents = useMemo(
    () =>
      occurrences
        .filter((o) => o.start < dayEnd && o.end > dayStart)
        .sort((a, b) => {
          const aAll = Number(a.event.allDay || a.end - a.start >= MS_DAY);
          const bAll = Number(b.event.allDay || b.end - b.start >= MS_DAY);
          return bAll - aAll || a.start - b.start;
        }),
    [occurrences, dayStart, dayEnd],
  );

  const todayTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.due >= dayStart && t.due < dayEnd)
        .sort((a, b) => Number(a.completed) - Number(b.completed) || a.due - b.due),
    [tasks, dayStart, dayEnd],
  );

  const openCount = todayTasks.filter((t) => !t.completed).length;
  const now = new Date();

  return (
    <div className="today-page">
      <div className="today-head">
        <h1 className="today-title">Today</h1>
        <p className="today-date">
          {now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ·{' '}
          {now.toLocaleDateString('en-GB', { weekday: 'long' })}
          {openCount > 0 && <span className="today-count"> · {openCount} to do</span>}
        </p>
      </div>

      {todayEvents.length > 0 && (
        <div className="today-events-block">
          {todayEvents.map((occ) => {
            const cal = calById.get(occ.event.calendarId);
            const color = occ.event.color ?? cal?.color ?? 'var(--accent)';
            const isAllDay = occ.event.allDay || occ.end - occ.start >= MS_DAY;
            return (
              <button
                key={occ.key}
                className="tev-row"
                style={{ ['--ev' as any]: color }}
                onClick={(e) => onEventClick(occ, (e.currentTarget as HTMLElement).getBoundingClientRect())}
              >
                {!isAllDay && (
                  <span className="tev-time">
                    {fmtTime(occ.start)}–{fmtTime(occ.end)}
                  </span>
                )}
                <span className="tev-title">{occ.event.title || '(untitled)'}</span>
                {occ.event.alarms.length > 0 && !occ.event.allDay && (
                  <span className="tev-bell">
                    <RingingBell size={10} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="today-tasks">
        {todayTasks.map((occ) => {
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
                  {occ.task.alarms.length > 0 && occ.task.hasTime && <RingingBell size={10} />}
                  <span className="task-list-name" style={{ color }}>
                    {cal?.name}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {todayEvents.length === 0 && todayTasks.length === 0 && (
        <div className="agenda-empty">
          <p>Nothing planned today. Enjoy the quiet — or tap + to change that.</p>
        </div>
      )}
    </div>
  );
}
