import { useMemo } from 'react';
import type { CalendarInfo, Occurrence, TaskOccurrence } from '../types';
import { MS_DAY, addDays, endOfDay, fmtTime, isToday, startOfDay, startOfMonth, startOfWeek } from '../lib/dates';
import { RingingBell } from './icons';

interface Props {
  date: Date;
  occurrences: Occurrence[];
  tasks: TaskOccurrence[];
  calendars: CalendarInfo[];
  weekStartsOn: 0 | 1;
  onEventClick: (occ: Occurrence, anchor: DOMRect) => void;
  onTaskClick: (occ: TaskOccurrence) => void;
  onDayClick: (day: Date) => void;
  onDayNumberClick: (day: Date) => void;
  maxChips?: number;
}

export function MonthView({
  date,
  occurrences,
  tasks,
  calendars,
  weekStartsOn,
  onEventClick,
  onTaskClick,
  onDayClick,
  onDayNumberClick,
  maxChips = 4,
}: Props) {
  const monthStart = startOfMonth(date);
  const gridStart = startOfWeek(monthStart, weekStartsOn);
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart.getTime()]);
  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  const byDay = useMemo(() => {
    const map = new Map<number, Occurrence[]>();
    for (const cell of cells) map.set(cell.getTime(), []);
    for (const occ of occurrences) {
      // an occurrence shows on every day it overlaps
      let d = startOfDay(occ.start).getTime();
      const last = Math.min(occ.end - 1, cells[41].getTime() + MS_DAY - 1);
      while (d <= last) {
        map.get(d)?.push(occ);
        d += MS_DAY;
        if (occ.end - occ.start <= 0) break;
      }
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          Number(b.event.allDay) - Number(a.event.allDay) || a.start - b.start,
      );
    }
    return map;
  }, [occurrences, cells]);

  const tasksByDay = useMemo(() => {
    const map = new Map<number, TaskOccurrence[]>();
    for (const occ of tasks) {
      if (occ.completed) continue; // keep month view uncluttered
      const d = startOfDay(occ.due).getTime();
      (map.get(d) ?? map.set(d, []).get(d)!).push(occ);
    }
    return map;
  }, [tasks]);

  const dows = Array.from({ length: 7 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="month-view">
      <div className="month-dows">
        {dows.map((d) => (
          <div key={d.getDay()}>{d.toLocaleDateString('en-GB', { weekday: 'short' })}</div>
        ))}
      </div>
      <div className="month-grid">
        {cells.map((cell) => {
          const list = byDay.get(cell.getTime()) ?? [];
          const dayTasks = tasksByDay.get(cell.getTime()) ?? [];
          const budget = Math.max(maxChips - Math.min(dayTasks.length, 1), 1);
          const overflow = list.length - budget;
          const shown = overflow > 1 ? list.slice(0, budget - 1) : list.slice(0, budget);
          const more = list.length - shown.length;
          const out = cell.getMonth() !== date.getMonth();
          return (
            <div
              key={cell.getTime()}
              className={`month-cell${out ? ' is-out' : ''}${isToday(cell) ? ' is-today' : ''}`}
              onDoubleClick={() => onDayClick(cell)}
            >
              <span
                className="month-daynum"
                role="button"
                tabIndex={0}
                onClick={() => onDayNumberClick(cell)}
                onKeyDown={(e) => e.key === 'Enter' && onDayNumberClick(cell)}
                title="Open day view"
              >
                {cell.getDate()}
              </span>
              {shown.map((occ) => {
                const cal = calById.get(occ.event.calendarId);
                const color = occ.event.color ?? cal?.color ?? 'var(--accent)';
                const continues = occ.start < cell.getTime();
                return (
                  <button
                    key={occ.key + cell.getTime()}
                    className={`chip${occ.event.allDay || occ.end - occ.start >= MS_DAY ? ' all-day' : ''}`}
                    style={{ ['--ev' as any]: color }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEventClick(occ, (e.currentTarget as HTMLElement).getBoundingClientRect());
                    }}
                  >
                    {!occ.event.allDay && occ.end - occ.start < MS_DAY && (
                      <>
                        <span className="dot" style={{ background: color, width: 6, height: 6 }} />
                        <span className="chip-time">{fmtTime(occ.start)}</span>
                      </>
                    )}
                    <span className="chip-title">
                      {continues ? '↳ ' : ''}
                      {occ.event.title || '(untitled)'}
                    </span>
                    {occ.event.alarms.length > 0 && !occ.event.allDay && (
                      <span className="bell-mini" style={{ marginLeft: 'auto' }}>
                        <RingingBell size={9} />
                      </span>
                    )}
                  </button>
                );
              })}
              {dayTasks.slice(0, 2).map((occ) => {
                const cal = calById.get(occ.task.calendarId);
                const color = cal?.color ?? 'var(--accent)';
                return (
                  <button
                    key={occ.key}
                    className="chip task-chip"
                    style={{ ['--ev' as any]: color }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTaskClick(occ);
                    }}
                  >
                    <span className="task-ring" style={{ borderColor: color }} />
                    <span className="chip-title">{occ.task.title || '(untitled)'}</span>
                  </button>
                );
              })}
              {more > 0 && (
                <button className="more-link" onClick={() => onDayNumberClick(cell)}>
                  {more} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
