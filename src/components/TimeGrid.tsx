import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarInfo, Occurrence, TaskOccurrence } from '../types';
import {
  MS_DAY,
  MS_MIN,
  fmtTime,
  fmtWeekdayShort,
  isSameDay,
  isToday,
  minutesOfDay,
  setMinutesOfDay,
  startOfDay,
} from '../lib/dates';
import { RingingBell } from './icons';

const SNAP = 15; // minutes — fine-tuning moves/resizes
const CREATE_SNAP = 30; // selecting a new slot always lands on :00 or :30
const HOUR_H = 52; // must match --hour-h
const MIN_EVENT_MIN = 15;

interface Props {
  days: Date[];
  occurrences: Occurrence[];
  tasks: TaskOccurrence[];
  calendars: CalendarInfo[];
  onCreate: (start: number, end: number, allDay?: boolean) => void;
  onEventClick: (occ: Occurrence, anchor: DOMRect) => void;
  onToggleTask: (occ: TaskOccurrence) => void;
  onTaskClick: (occ: TaskOccurrence) => void;
  onMoveOccurrence: (occ: Occurrence, newStart: number, newEnd: number) => void;
  onDayHeadClick: (day: Date) => void;
}

/** column layout for overlapping events (classic interval clustering) */
interface Positioned {
  occ: Occurrence;
  col: number;
  cols: number;
}

function layoutDay(occs: Occurrence[]): Positioned[] {
  const sorted = [...occs].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Positioned[] = [];
  let cluster: { occ: Occurrence; col: number }[] = [];
  let clusterEnd = -Infinity;
  let colEnds: number[] = [];

  const flush = () => {
    const cols = colEnds.length || 1;
    for (const item of cluster) out.push({ occ: item.occ, col: item.col, cols });
    cluster = [];
    colEnds = [];
  };

  for (const occ of sorted) {
    if (occ.start >= clusterEnd && cluster.length) flush();
    let col = colEnds.findIndex((end) => end <= occ.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(occ.end);
    } else {
      colEnds[col] = occ.end;
    }
    cluster.push({ occ, col });
    clusterEnd = Math.max(clusterEnd, occ.end);
  }
  flush();
  return out;
}

type DragState =
  | { kind: 'create'; dayIdx: number; anchorMin: number; startMin: number; endMin: number }
  | {
      kind: 'move' | 'resize';
      occ: Occurrence;
      startMin: number;
      endMin: number;
      dayIdx: number;
      origDayIdx: number;
      grabOffsetMin: number;
      moved: boolean;
      pointerId: number;
    };

export function TimeGrid({
  days,
  occurrences,
  tasks,
  calendars,
  onCreate,
  onEventClick,
  onToggleTask,
  onTaskClick,
  onMoveOccurrence,
  onDayHeadClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const suppressEventClickRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const calById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // initial scroll to 07:30
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7.5 * HOUR_H;
  }, [days.length]);

  const timed = useMemo(
    () => occurrences.filter((o) => !o.event.allDay && o.end - o.start < MS_DAY),
    [occurrences],
  );
  const allDay = useMemo(
    () => occurrences.filter((o) => o.event.allDay || o.end - o.start >= MS_DAY),
    [occurrences],
  );

  const perDay = useMemo(
    () =>
      days.map((day) => {
        const ds = day.getTime();
        const de = ds + MS_DAY;
        return layoutDay(timed.filter((o) => o.start < de && o.end > ds));
      }),
    [days, timed],
  );

  const yToMin = (clientY: number, snap = SNAP): number => {
    const rect = colsRef.current!.getBoundingClientRect();
    const y = clientY - rect.top;
    const min = (y / HOUR_H) * 60;
    return Math.max(0, Math.min(24 * 60, Math.round(min / snap) * snap));
  };

  const xToDayIdx = (clientX: number): number => {
    const rect = colsRef.current!.getBoundingClientRect();
    const w = rect.width / days.length;
    return Math.max(0, Math.min(days.length - 1, Math.floor((clientX - rect.left) / w)));
  };

  /* ---- drag to create on empty space ----
     mouse: drag immediately; touch: long-press first (400ms), so vertical
     scrolling and horizontal page-swiping stay free */
  const pendingTouch = useRef<{ timer: number; x: number; y: number } | null>(null);

  const cancelPendingTouch = () => {
    if (pendingTouch.current) {
      clearTimeout(pendingTouch.current.timer);
      pendingTouch.current = null;
    }
  };

  const onColPointerDown = (e: React.PointerEvent, dayIdx: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.tg-event')) return;
    if (e.pointerType === 'touch') {
      const clientY = e.clientY;
      cancelPendingTouch();
      pendingTouch.current = {
        x: e.clientX,
        y: clientY,
        timer: window.setTimeout(() => {
          pendingTouch.current = null;
          navigator.vibrate?.(10);
          const anchorMin = yToMin(clientY, CREATE_SNAP);
          setDrag({ kind: 'create', dayIdx, anchorMin, startMin: anchorMin, endMin: anchorMin + 60 });
        }, 400),
      };
      return;
    }
    const anchorMin = yToMin(e.clientY, CREATE_SNAP);
    setDrag({ kind: 'create', dayIdx, anchorMin, startMin: anchorMin, endMin: anchorMin + 60 });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  /* ---- drag existing event (move / resize) ---- */
  const onEventPointerDown = (e: React.PointerEvent, occ: Occurrence, dayIdx: number, resize: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const startMin = minutesOfDay(Math.max(occ.start, days[dayIdx].getTime()));
    const rawEnd = occ.end;
    const endMin = isSameDay(rawEnd - 1, days[dayIdx]) ? minutesOfDay(rawEnd) || 24 * 60 : 24 * 60;
    setDrag({
      kind: resize ? 'resize' : 'move',
      occ,
      startMin,
      endMin,
      dayIdx,
      origDayIdx: dayIdx,
      grabOffsetMin: yToMin(e.clientY) - startMin,
      moved: false,
      pointerId: e.pointerId,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pendingTouch.current) {
      const p = pendingTouch.current;
      if (Math.abs(e.clientX - p.x) > 8 || Math.abs(e.clientY - p.y) > 8) cancelPendingTouch();
    }
    if (!drag) return;
    const min = yToMin(e.clientY, drag.kind === 'create' ? CREATE_SNAP : SNAP);
    const dayIdx = xToDayIdx(e.clientX);
    if (drag.kind === 'create') {
      const [s, en] =
        min >= drag.anchorMin
          ? [drag.anchorMin, Math.max(min, drag.anchorMin + CREATE_SNAP)]
          : [min, drag.anchorMin];
      setDrag({ ...drag, startMin: s, endMin: en });
    } else if (drag.kind === 'move') {
      const dur = drag.endMin - drag.startMin;
      const ns = Math.max(0, Math.min(24 * 60 - dur, min - drag.grabOffsetMin));
      const snapped = Math.round(ns / SNAP) * SNAP;
      const moved = drag.moved || Math.abs(snapped - drag.startMin) >= SNAP || dayIdx !== drag.dayIdx;
      setDrag({ ...drag, startMin: snapped, endMin: snapped + dur, dayIdx, moved });
    } else {
      const ne = Math.max(drag.startMin + MIN_EVENT_MIN, min);
      setDrag({ ...drag, endMin: ne, moved: drag.moved || ne !== drag.endMin });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    cancelPendingTouch();
    if (!drag) return;
    if (drag.kind === 'create') {
      if (drag.endMin - drag.startMin >= CREATE_SNAP) {
        onCreate(
          setMinutesOfDay(days[drag.dayIdx], drag.startMin).getTime(),
          setMinutesOfDay(days[drag.dayIdx], drag.endMin).getTime(),
        );
      }
    } else if (drag.moved) {
      suppressEventClickRef.current = true;
      window.setTimeout(() => {
        suppressEventClickRef.current = false;
      }, 0);
      const day = days[drag.kind === 'move' ? drag.dayIdx : drag.origDayIdx];
      const newStart =
        drag.kind === 'move'
          ? setMinutesOfDay(day, drag.startMin).getTime()
          : drag.occ.start;
      const newEnd =
        drag.kind === 'move'
          ? newStart + (drag.occ.end - drag.occ.start)
          : setMinutesOfDay(day, drag.endMin).getTime();
      onMoveOccurrence(drag.occ, newStart, newEnd);
    }
    setDrag(null);
  };

  const hours = Array.from({ length: 23 }, (_, i) => i + 1);

  return (
    <div className="timegrid">
      <div className="tg-header">
        <div className="tg-header-gutter" />
        {days.map((day) => (
          <div
            key={day.getTime()}
            className={`tg-dayhead${isToday(day) ? ' is-today' : ''}`}
            onClick={() => onDayHeadClick(day)}
            role="button"
          >
            <div className="tg-dow">{fmtWeekdayShort(day)}</div>
            <div className="tg-daynum">{day.getDate()}</div>
          </div>
        ))}
      </div>

      <div className="allday-row">
        <div className="allday-gutter">all-day</div>
        {days.map((day) => {
          const ds = day.getTime();
          const list = allDay.filter((o) => o.start < ds + MS_DAY && o.end > ds);
          const dayTasks = tasks
            .filter((t) => t.due >= ds && t.due < ds + MS_DAY)
            .sort((a, b) => Number(a.completed) - Number(b.completed) || a.due - b.due);
          return (
            <div key={ds} className="allday-col">
              {list.map((occ) => {
                const cal = calById.get(occ.event.calendarId);
                const color = occ.event.color ?? cal?.color ?? 'var(--accent)';
                return (
                  <button
                    key={occ.key}
                    className="chip all-day"
                    style={{ ['--ev' as any]: color }}
                    onClick={(e) =>
                      onEventClick(occ, (e.currentTarget as HTMLElement).getBoundingClientRect())
                    }
                  >
                    <span className="chip-title">{occ.event.title || '(untitled)'}</span>
                  </button>
                );
              })}
              {dayTasks.map((occ) => {
                const cal = calById.get(occ.task.calendarId);
                const color = cal?.color ?? 'var(--accent)';
                return (
                  <span
                    key={occ.key}
                    className={`chip task-chip${occ.completed ? ' is-done' : ''}`}
                    style={{ ['--ev' as any]: color }}
                  >
                    <button
                      className="task-ring"
                      style={{ borderColor: color, background: occ.completed ? color : undefined }}
                      aria-label={occ.completed ? 'Mark as not done' : 'Mark as done'}
                      onClick={() => onToggleTask(occ)}
                    />
                    <button className="chip-title task-chip-title" onClick={() => onTaskClick(occ)}>
                      {occ.task.hasTime && <span className="chip-time">{fmtTime(occ.due)}</span>}{' '}
                      {occ.task.title || '(untitled)'}
                    </button>
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-canvas">
          <div className="tg-gutter">
            {hours.map((h) => (
              <div key={h} className="tg-hour-label" style={{ top: h * HOUR_H }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          <div
            style={{ display: 'flex', flex: 1, minWidth: 0, position: 'relative' }}
            ref={colsRef}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              cancelPendingTouch();
              setDrag(null);
            }}
          >
            {days.map((day, dayIdx) => {
              const today = isToday(day);
              return (
                <div
                  key={day.getTime()}
                  className={`tg-col${today ? ' is-today' : ''}`}
                  onPointerDown={(e) => onColPointerDown(e, dayIdx)}
                >
                  {hours.map((h) => (
                    <div key={h} className="tg-hline" style={{ top: h * HOUR_H }} />
                  ))}

                  {perDay[dayIdx].map(({ occ, col, cols }) => {
                    const ds = day.getTime();
                    const startMin = Math.max(0, (occ.start - ds) / MS_MIN);
                    const endMin = Math.min(24 * 60, (occ.end - ds) / MS_MIN);
                    const durationMin = endMin - startMin;
                    const isDragTarget =
                      drag && drag.kind !== 'create' && drag.occ.key === occ.key;
                    const cal = calById.get(occ.event.calendarId);
                    const color = occ.event.color ?? cal?.color ?? 'var(--accent)';
                    const widthPct = 100 / cols;
                    return (
	                      <div
	                        key={occ.key}
	                        className={`tg-event${durationMin <= 20 ? ' is-tiny' : durationMin <= 30 ? ' is-short' : ''}${isDragTarget && drag.moved ? ' is-dragging' : ''}${occ.end < now ? ' is-past' : ''}`}
	                        style={{
                          top: (startMin / 60) * HOUR_H,
                          height: Math.max(((endMin - startMin) / 60) * HOUR_H - 2, 14),
                          left: `calc(${col * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 6px)`,
                          ['--ev' as any]: color,
                        }}
                        onPointerDown={(e) => onEventPointerDown(e, occ, dayIdx, false)}
                        onClick={(e) => {
                          if (suppressEventClickRef.current) return;
                          onEventClick(occ, (e.currentTarget as HTMLElement).getBoundingClientRect());
                        }}
                      >
                        <div className="tg-ev-title">
                          <span className="tg-ev-title-text">{occ.event.title || '(untitled)'}</span>
                          {occ.event.alarms.length > 0 && (
                            <span className="bell-mini">
                              <RingingBell size={10} />
                            </span>
                          )}
                        </div>
                        <div className="tg-ev-time">
                          {fmtTime(occ.start)} – {fmtTime(occ.end)}
                        </div>
                        <div
                          className="resize-handle"
                          onPointerDown={(e) => onEventPointerDown(e, occ, dayIdx, true)}
                        />
                      </div>
                    );
                  })}

                  {/* ghost while creating or dragging */}
                  {drag &&
                    ((drag.kind === 'create' && drag.dayIdx === dayIdx) ||
                      (drag.kind === 'move' && drag.dayIdx === dayIdx && drag.moved) ||
                      (drag.kind === 'resize' && drag.origDayIdx === dayIdx && drag.moved)) && (
                      <div
                        className="ghost-event"
                        style={{
                          top: (drag.startMin / 60) * HOUR_H,
                          height: Math.max(((drag.endMin - drag.startMin) / 60) * HOUR_H - 2, 12),
                        }}
                      >
                        {fmtTime(setMinutesOfDay(day, drag.startMin))} –{' '}
                        {fmtTime(setMinutesOfDay(day, drag.endMin))}
                      </div>
                    )}

                  {today && (
                    <div className="now-line" style={{ top: (minutesOfDay(now) / 60) * HOUR_H }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
