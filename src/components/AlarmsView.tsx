import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AlarmClockItem } from '../types';
import { describeRepeatDays, fmtAlarmTime, hourHue, nextAlarmMoment } from '../lib/alarmClocks';
import { uid } from '../state/store';
import { ensureAudioUnlocked } from '../alarm/sound';
import { easeScrollIntoView } from '../lib/scroll';
import { AlarmClockIcon, Pencil, Repeat, Trash } from './icons';

interface Props {
  alarms: AlarmClockItem[];
  onCreate: (alarm: AlarmClockItem) => void;
  onToggle: (alarm: AlarmClockItem, enabled: boolean) => void;
  onEdit: (alarm: AlarmClockItem) => void;
  onEditOptions: (alarm: AlarmClockItem) => void;
  onDelete: (id: string) => void;
}

/**
 * Two-step alarm creation in the cube language: a grid of hour tiles
 * (07 first — the hours you actually wake at — wrapping through the night),
 * each colored by a full-spectrum time-of-day hue. Tapping an hour pushes
 * its row apart and slides a minute lane in from the right; tapping a
 * minute saves the alarm instantly and lands it on the Saved tab.
 */

/** 07…23 first, then 00…06 — a 4-column, 6-row grid */
const HOURS = Array.from({ length: 24 }, (_, i) => (i + 7) % 24);
const HOUR_COLS = 4;
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const LANE_CLOSE_MS = 300;

const SWIPE_DELETE_PX = 90;
const SWIPE_REMOVE_MS = 340;

/**
 * Swipe-left-to-delete wrapper: dragging reveals a red trash surface
 * behind the card; past the threshold the card flies out left and the
 * gap collapses with easing before the alarm is actually removed.
 */
function SwipeAlarmRow({ children, onDelete }: { children: ReactNode; onDelete: () => void }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const gesture = useRef<{ x: number; y: number; id: number; swiping: boolean } | null>(null);

  const finish = () => {
    setRemoving(true);
    setDragging(false);
    setDx(-500);
    window.setTimeout(onDelete, SWIPE_REMOVE_MS);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (removing) return;
    gesture.current = { x: e.clientX, y: e.clientY, id: e.pointerId, swiping: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || removing) return;
    const ddx = e.clientX - g.x;
    const ddy = e.clientY - g.y;
    if (!g.swiping) {
      if (Math.abs(ddx) < 10 || Math.abs(ddx) < Math.abs(ddy)) return;
      g.swiping = true;
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(g.id);
    }
    setDx(Math.min(0, ddx));
  };

  const onPointerEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.swiping || removing) return;
    setDragging(false);
    if (dx < -SWIPE_DELETE_PX) finish();
    else setDx(0);
  };

  return (
    <div className={`alarm-swipe${removing ? ' is-removing' : ''}`}>
      <div className="alarm-swipe-inner">
        <div className="alarm-swipe-bg" aria-hidden="true">
          <Trash size={20} />
        </div>
        <div
          className="alarm-swipe-card"
          style={{
            transform: `translateX(${dx}px)`,
            transition: dragging ? 'none' : undefined,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** grid-rows wrapper so the tile rows shove apart with easing */
function LaneSlot({ children, closing }: { children: ReactNode; closing: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let done = false;
    const fire = () => {
      if (!done) {
        done = true;
        setOpen(true);
      }
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(fire));
    const to = window.setTimeout(fire, 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(to);
    };
  }, []);
  return (
    <div className={`minute-lane-slot${open && !closing ? ' is-open' : ''}`}>
      <div className="minute-lane-slot-inner">{children}</div>
    </div>
  );
}

export function AlarmsView({ alarms, onCreate, onToggle, onEdit, onEditOptions, onDelete }: Props) {
  const [tab, setTab] = useState<'new' | 'saved'>('new');
  const [pickHour, setPickHour] = useState<number | null>(null);
  const [laneClosing, setLaneClosing] = useState(false);
  const laneSectionRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...alarms].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute)),
    [alarms],
  );

  const toggleHour = (hour: number) => {
    if (laneClosing) return;
    setPickHour((cur) => {
      const next = cur === hour ? null : hour;
      if (next !== null) {
        // scroll WHILE the lane pushes the rows apart: measure the height
        // it is about to gain and tween to the final position right away
        window.setTimeout(() => {
          const section = laneSectionRef.current;
          if (!section) return;
          const inner = section.querySelector<HTMLElement>('.minute-lane-slot-inner');
          const extra = inner ? Math.max(0, inner.scrollHeight - inner.clientHeight) : 0;
          easeScrollIntoView(section, 110, 340, extra);
        }, 30);
      }
      return next;
    });
  };

  const pickMinute = (hour: number, minute: number) => {
    if (laneClosing) return;
    ensureAudioUnlocked();
    setLaneClosing(true);
    window.setTimeout(() => {
      onCreate({
        id: uid(),
        hour,
        minute,
        label: '',
        repeatDays: [],
        enabled: true,
        anchor: nextAlarmMoment(hour, minute, Date.now()),
      });
      setPickHour(null);
      setLaneClosing(false);
      setTab('saved'); // watch the new alarm land
    }, LANE_CLOSE_MS);
  };

  /* chunk the hour tiles into rows so the lane can live under its row */
  const rows: number[][] = [];
  for (let i = 0; i < HOURS.length; i += HOUR_COLS) rows.push(HOURS.slice(i, i + HOUR_COLS));

  return (
    <div className="today-page alarms-page">
      <div className="today-head">
        <h1 className="today-title">Alarms</h1>
      </div>

      <div className="alarm-tabs" role="tablist" aria-label="Alarms">
        <span
          className="alarm-tabs-pill"
          aria-hidden="true"
          style={{ transform: `translateX(${tab === 'saved' ? 'calc(100% + 4px)' : '0'})` }}
        />
        <button
          role="tab"
          aria-selected={tab === 'new'}
          className={`alarm-tab${tab === 'new' ? ' is-active' : ''}`}
          onClick={() => setTab('new')}
        >
          New alarm
        </button>
        <button
          role="tab"
          aria-selected={tab === 'saved'}
          className={`alarm-tab${tab === 'saved' ? ' is-active' : ''}`}
          onClick={() => setTab('saved')}
        >
          Saved{sorted.length > 0 && <span className="alarm-tab-count">{sorted.length}</span>}
        </button>
      </div>

      {tab === 'new' && (
        <div className="hour-grid-wrap">
          {rows.map((row, ri) => {
            const laneHour = row.find((h) => h === pickHour);
            return (
              <div
                key={ri}
                className="hour-grid-section"
                ref={laneHour !== undefined ? laneSectionRef : undefined}
              >
                <div className="hour-grid-row">
                  {row.map((hour, ci) => (
                    <button
                      key={hour}
                      className={`hour-tile${pickHour === hour ? ' is-picked' : ''}`}
                      style={{
                        ['--th' as any]: hourHue(hour),
                        animationDelay: `${(ri * HOUR_COLS + ci) * 16}ms`,
                      }}
                      aria-expanded={pickHour === hour}
                      onClick={() => toggleHour(hour)}
                    >
                      <span className="hour-tile-num">{String(hour).padStart(2, '0')}</span>
                      <span className="hour-tile-unit">h</span>
                    </button>
                  ))}
                </div>
                {laneHour !== undefined && (
                  <LaneSlot key={laneHour} closing={laneClosing}>
                    <div className="minute-lane" style={{ ['--th' as any]: hourHue(laneHour) }}>
                      {MINUTES.map((minute, mi) => (
                        <button
                          key={minute}
                          className="minute-chip"
                          style={{ animationDelay: `${120 + mi * 22}ms` }}
                          onClick={() => pickMinute(laneHour, minute)}
                        >
                          {fmtAlarmTime(laneHour, minute)}
                        </button>
                      ))}
                    </div>
                  </LaneSlot>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'saved' &&
        (sorted.length === 0 ? (
          <div className="agenda-empty alarms-empty">
            <div className="alarm-empty-art" aria-hidden="true">
              <span className="alarm-empty-cube c1" />
              <span className="alarm-empty-cube c2">
                <AlarmClockIcon size={24} />
              </span>
              <span className="alarm-empty-cube c3" />
            </div>
            <p>No alarms yet. Pick an hour on the New alarm tab — it rings for real and shows up in your calendar.</p>
          </div>
        ) : (
          <div className="alarm-list">
            {sorted.map((alarm, i) => (
              <SwipeAlarmRow key={alarm.id} onDelete={() => onDelete(alarm.id)}>
                <div
                  className={`alarm-row${alarm.enabled ? '' : ' is-off'}`}
                  style={{
                    ['--th' as any]: hourHue(alarm.hour),
                    animationDelay: `${i * 40}ms`,
                  }}
                >
                  <button className="alarm-row-main" onClick={() => onEdit(alarm)}>
                    <span className="alarm-time">{fmtAlarmTime(alarm.hour, alarm.minute)}</span>
                    <span className="alarm-meta">
                      {alarm.label || 'Alarm'} · {describeRepeatDays(alarm.repeatDays)}
                    </span>
                  </button>
                  <div className="alarm-row-actions">
                    <button
                      className="alarm-icon-btn"
                      aria-label="Repeat and label"
                      onClick={() => onEditOptions(alarm)}
                    >
                      <Repeat size={17} />
                    </button>
                    <button className="alarm-icon-btn" aria-label="Edit alarm" onClick={() => onEdit(alarm)}>
                      <Pencil size={16} />
                    </button>
                    <input
                      type="checkbox"
                      className="ios-switch"
                      checked={alarm.enabled}
                      onChange={(e) => onToggle(alarm, e.target.checked)}
                      aria-label={`${alarm.label || 'Alarm'} ${fmtAlarmTime(alarm.hour, alarm.minute)}`}
                    />
                  </div>
                </div>
              </SwipeAlarmRow>
            ))}
          </div>
        ))}
    </div>
  );
}
