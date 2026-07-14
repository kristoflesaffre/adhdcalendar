import { useEffect, useRef, useState } from 'react';
import type { EventItem, Recurrence } from '../types';
import { EVENT_PALETTE } from '../types';
import { MS_DAY, MS_HOUR, startOfDay } from '../lib/dates';
import { useStore } from '../state/store';
import { ensureAudioUnlocked } from '../alarm/sound';
import { MiniMonth } from './MiniMonth';
import { ChevronDown, Clock, Notes, Palette, Pin, ReminderIcon, Repeat, RingingBell } from './icons';

/**
 * Google Calendar iOS event editor, rebuilt interaction-for-interaction:
 * no input boxes — tappable rows. The date opens an inline month grid, the
 * time opens an inline hour/minute wheel, notifications open a menu
 * (None / 30 minutes before / … / Custom), and "More options" reveals
 * repeat, colour and description. Mobile only; desktop keeps EventEditor.
 */

interface Props {
  draft: EventItem;
  isNew: boolean;
  onSave: (ev: EventItem) => void;
  onDelete?: () => void;
  onClose: () => void;
  onSwitchToTask?: () => void;
}

type Expanded = null | 'startDate' | 'startTime' | 'endDate' | 'endTime';

const fmtRowDate = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
const fmtRowTime = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "30 minutes before", "1 hour before", "At start" — Google's phrasing */
function alarmLabel(m: number): string {
  if (m === 0) return 'At time of event';
  if (m % 10080 === 0) return `${m / 10080} week${m / 10080 > 1 ? 's' : ''} before`;
  if (m % 1440 === 0) return `${m / 1440} day${m / 1440 > 1 ? 's' : ''} before`;
  if (m % 60 === 0) return `${m / 60} hour${m / 60 > 1 ? 's' : ''} before`;
  return `${m} minutes before`;
}

const MENU_CHOICES = [0, 10, 30, 60, 1440, 10080];
const ALARM_CHOICES = [0, 5, 10, 15];

type RecChoice = 'none' | 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

function recToChoice(r?: Recurrence): RecChoice {
  if (!r) return 'none';
  if (r.freq === 'WEEKLY' && r.byDay && r.byDay.length === 5) return 'WEEKDAYS';
  return r.freq;
}

function choiceToRec(c: RecChoice, start: number): Recurrence | undefined {
  switch (c) {
    case 'none':
      return undefined;
    case 'DAILY':
      return { freq: 'DAILY', interval: 1 };
    case 'WEEKDAYS':
      return { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5] };
    case 'WEEKLY':
      return { freq: 'WEEKLY', interval: 1, byDay: [new Date(start).getDay()] };
    case 'MONTHLY':
      return { freq: 'MONTHLY', interval: 1 };
    case 'YEARLY':
      return { freq: 'YEARLY', interval: 1 };
  }
}

/* ------------------- inline time wheel ------------------- */

const ROW_H = 48;

function WheelColumn({
  values,
  selected,
  onSelect,
  render,
}: {
  values: number[];
  selected: number;
  onSelect: (v: number) => void;
  render: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  const suppress = useRef(false);

  useEffect(() => {
    const idx = Math.max(values.indexOf(selected), 0);
    suppress.current = true;
    ref.current?.scrollTo({ top: idx * ROW_H });
    const t = setTimeout(() => (suppress.current = false), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    if (suppress.current) return;
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ROW_H)));
      if (values[idx] !== selected) onSelect(values[idx]);
    }, 90);
  };

  return (
    <div className="twheel-col" ref={ref} onScroll={onScroll}>
      <div className="twheel-pad" />
      {values.map((v) => (
        <button
          key={v}
          className={`twheel-item${v === selected ? ' is-selected' : ''}`}
          onClick={() => {
            const idx = values.indexOf(v);
            ref.current?.scrollTo({ top: idx * ROW_H, behavior: 'smooth' });
            onSelect(v);
          }}
        >
          {render(v)}
        </button>
      ))}
      <div className="twheel-pad" />
    </div>
  );
}

function TimeWheel({ value, onChange }: { value: number; onChange: (t: number) => void }) {
  const d = new Date(value);
  const hour = d.getHours();
  const minute = Math.round(d.getMinutes() / 5) * 5 === 60 ? 55 : Math.round(d.getMinutes() / 5) * 5;
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);

  const set = (h: number, m: number) => {
    const next = new Date(value);
    next.setHours(h, m, 0, 0);
    onChange(next.getTime());
  };

  return (
    <div className="twheel">
      <div className="twheel-band" />
      <WheelColumn values={hours} selected={hour} onSelect={(h) => set(h, minute)} render={(v) => String(v)} />
      <WheelColumn
        values={minutes}
        selected={minute}
        onSelect={(m) => set(hour, m)}
        render={(v) => String(v).padStart(2, '0')}
      />
      <div className="twheel-fade top" />
      <div className="twheel-fade bottom" />
    </div>
  );
}

/* ------------------- the sheet ------------------- */

export function EventSheet({ draft, isNew, onSave, onDelete, onClose, onSwitchToTask }: Props) {
  const { state } = useStore();
  const [ev, setEv] = useState<EventItem>(draft);
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [showMore, setShowMore] = useState(false);
  const [notificationMenu, setNotificationMenu] = useState<null | { target: number | 'new' }>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState('');
  const writableCals = state.calendars.filter((c) => !c.readOnly);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const patch = (p: Partial<EventItem>) => setEv((cur) => ({ ...cur, ...p }));
  const toggleExpand = (which: Expanded) => setExpanded((cur) => (cur === which ? null : which));

  const setStart = (t: number) => {
    const dur = ev.end - ev.start;
    patch({ start: t, end: t + dur });
  };
  const setStartDate = (d: Date) => {
    const cur = new Date(ev.start);
    const next = new Date(d);
    next.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
    setStart(next.getTime());
  };
  const setEndDate = (d: Date) => {
    const cur = new Date(ev.end);
    const next = new Date(d);
    next.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
    patch({ end: Math.max(next.getTime(), ev.start + 15 * 60_000) });
  };
  const setEndTime = (t: number) => patch({ end: t > ev.start ? t : ev.start + 15 * 60_000 });

  const setAllDay = (allDay: boolean) => {
    setExpanded(null);
    if (allDay) {
      const s = startOfDay(ev.start).getTime();
      patch({ allDay, start: s, end: Math.max(startOfDay(ev.end - 1).getTime() + MS_DAY, s + MS_DAY) });
    } else {
      const s = startOfDay(ev.start).getTime() + 9 * MS_HOUR;
      patch({ allDay, start: s, end: s + MS_HOUR });
    }
  };

  const sortedNotifications = [...ev.notifications].sort((a, b) => a - b);

  const applyNotificationChoice = (minutes: number | null) => {
    const menu = notificationMenu;
    setNotificationMenu(null);
    setCustomOpen(false);
    if (!menu) return;
    setEv((cur) => {
      let notifications = [...cur.notifications];
      if (menu.target === 'new') {
        if (minutes !== null && !notifications.includes(minutes)) notifications.push(minutes);
      } else {
        notifications = notifications.filter((m) => m !== menu.target);
        if (minutes !== null && !notifications.includes(minutes)) notifications.push(minutes);
      }
      return { ...cur, notifications: notifications.sort((a, b) => b - a) };
    });
  };

  const toggleAlarm = (minutes: number) => {
    ensureAudioUnlocked();
    setEv((cur) => ({
      ...cur,
      alarms: cur.alarms.includes(minutes)
        ? cur.alarms.filter((m) => m !== minutes)
        : [...cur.alarms, minutes].sort((a, b) => a - b),
    }));
  };

  const valid = ev.end > ev.start && !!ev.calendarId;
  const save = () => {
    if (!valid) return;
    ensureAudioUnlocked();
    onSave({ ...ev, title: ev.title.trim() });
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal gsheet" role="dialog" aria-modal="true" aria-label={isNew ? 'New event' : 'Edit event'}>
        <div className="gsheet-head">
          <button className="gsheet-cancel" onClick={onClose}>
            Cancel
          </button>
          <span className="gsheet-grab" aria-hidden="true">
            <ChevronDown size={22} />
          </span>
          <button
            className="gsheet-save"
            onClick={save}
            disabled={!valid}
            style={!valid ? { opacity: 0.4 } : undefined}
          >
            Save
          </button>
        </div>

        <div className="gsheet-scroll">
          <div className="gsheet-title-wrap">
            <input
              className="gsheet-title"
              placeholder="Add title"
              value={ev.title}
              autoFocus={isNew}
              onChange={(e) => patch({ title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            {isNew && onSwitchToTask && (
              <div className="kind-chips">
                <button className="cal-chip" aria-pressed="true">
                  Event
                </button>
                <button className="cal-chip" onClick={onSwitchToTask}>
                  Task
                </button>
              </div>
            )}
          </div>

          <div className="gdiv" />

          {/* all day */}
          <div className="grow-item">
            <span className="gicon">
              <Clock size={22} />
            </span>
            <span className="glabel">All day</span>
            <input
              type="checkbox"
              className="ios-switch"
              checked={ev.allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              aria-label="All day"
            />
          </div>

          {/* start */}
          <div className="grow-item gdt">
            <span className="gicon" />
            <button
              className={`gdt-date${expanded === 'startDate' ? ' is-open' : ''}`}
              onClick={() => toggleExpand('startDate')}
            >
              {fmtRowDate(ev.start)}
            </button>
            {!ev.allDay && (
              <button
                className={`gdt-time${expanded === 'startTime' ? ' is-open' : ''}`}
                onClick={() => toggleExpand('startTime')}
              >
                {fmtRowTime(ev.start)}
              </button>
            )}
          </div>
          {expanded === 'startDate' && (
            <div className="ginline">
              <MiniMonth
                selected={new Date(ev.start)}
                onSelect={(d) => setStartDate(d)}
                weekStartsOn={state.settings.weekStartsOn}
                busyDays={new Set()}
              />
            </div>
          )}
          {expanded === 'startTime' && (
            <div className="ginline">
              <TimeWheel value={ev.start} onChange={setStart} />
            </div>
          )}

          {/* end */}
          <div className="grow-item gdt">
            <span className="gicon" />
            <button
              className={`gdt-date${expanded === 'endDate' ? ' is-open' : ''}`}
              onClick={() => toggleExpand('endDate')}
            >
              {fmtRowDate(ev.allDay ? ev.end - 1 : ev.end)}
            </button>
            {!ev.allDay && (
              <button
                className={`gdt-time${expanded === 'endTime' ? ' is-open' : ''}`}
                onClick={() => toggleExpand('endTime')}
              >
                {fmtRowTime(ev.end)}
              </button>
            )}
          </div>
          {expanded === 'endDate' && (
            <div className="ginline">
              <MiniMonth
                selected={new Date(ev.allDay ? ev.end - 1 : ev.end)}
                onSelect={(d) =>
                  ev.allDay
                    ? patch({ end: Math.max(startOfDay(d).getTime() + MS_DAY, ev.start + MS_DAY) })
                    : setEndDate(d)
                }
                weekStartsOn={state.settings.weekStartsOn}
                busyDays={new Set()}
              />
            </div>
          )}
          {expanded === 'endTime' && (
            <div className="ginline">
              <TimeWheel value={ev.end} onChange={setEndTime} />
            </div>
          )}

          {!showMore && (
            <button className="gmore" onClick={() => setShowMore(true)}>
              More options
            </button>
          )}

          <div className="gdiv" />

          {/* calendar chips */}
          <div className="grow-item">
            <span className="gicon" />
            <div className="cal-chip-row">
              {writableCals.map((c) => (
                <button
                  key={c.id}
                  className="cal-chip"
                  aria-pressed={ev.calendarId === c.id}
                  style={{ ['--chip-color' as any]: c.color }}
                  onClick={() => patch({ calendarId: c.id })}
                >
                  <span className="dot" style={{ background: c.color }} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="gdiv" />

          {/* location */}
          <div className="grow-item">
            <span className="gicon">
              <Pin size={22} />
            </span>
            <input
              className="ginput"
              placeholder="Add location"
              value={ev.location ?? ''}
              onChange={(e) => patch({ location: e.target.value || undefined })}
            />
          </div>

          <div className="gdiv" />

          {/* standard notifications */}
          {!ev.allDay && (
            <>
              {sortedNotifications.map((m, i) => (
                <button
                  key={m}
                  className="grow-item galarm"
                  onClick={() => setNotificationMenu({ target: m })}
                >
                  <span className="gicon">{i === 0 ? <ReminderIcon size={23} /> : null}</span>
                  <span className="glabel">{alarmLabel(m)}</span>
                  <span className="gunfold">
                    <ChevronDown size={14} />
                  </span>
                </button>
              ))}
              <button className="grow-item galarm" onClick={() => setNotificationMenu({ target: 'new' })}>
                <span className="gicon">{sortedNotifications.length === 0 ? <ReminderIcon size={23} /> : null}</span>
                <span className="glabel gmuted">Add notification</span>
                <span className="gunfold">
                  <ChevronDown size={14} />
                </span>
              </button>

              <div className="grow-item galarm-choice editor-alarm-swimlane">
                <span className="gicon">
                  <RingingBell size={22} />
                </span>
                <div className="galarm-choice-body">
                  <span className="glabel">Alarm</span>
                  <div className="alarm-chips" role="group" aria-label="Alarm time">
                    {ALARM_CHOICES.map((m) => (
                      <button
                        key={m}
                        className="chip-btn"
                        aria-pressed={ev.alarms.includes(m)}
                        onClick={() => toggleAlarm(m)}
                      >
                        {m} min
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {showMore && (
            <>
              <div className="gdiv" />

              {/* repeat */}
              <div className="grow-item">
                <span className="gicon">
                  <Repeat size={22} />
                </span>
                <select
                  className="gselect"
                  value={recToChoice(ev.recurrence)}
                  onChange={(e) =>
                    patch({
                      recurrence: choiceToRec(e.target.value as RecChoice, ev.start),
                      exceptions: undefined,
                    })
                  }
                >
                  <option value="none">Does not repeat</option>
                  <option value="DAILY">Daily</option>
                  <option value="WEEKDAYS">Every weekday (Mon–Fri)</option>
                  <option value="WEEKLY">
                    Weekly on {new Date(ev.start).toLocaleDateString('en-GB', { weekday: 'long' })}
                  </option>
                  <option value="MONTHLY">Monthly on day {new Date(ev.start).getDate()}</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </div>

              {/* colour */}
              <div className="grow-item">
                <span className="gicon">
                  <Palette size={22} />
                </span>
                <span className="glabel">Colour</span>
                <span className="gswatches">
                  <button
                    className="swatch"
                    aria-pressed={!ev.color}
                    aria-label="Calendar colour"
                    style={{
                      background: state.calendars.find((c) => c.id === ev.calendarId)?.color,
                      opacity: ev.color ? 0.35 : 1,
                    }}
                    onClick={() => patch({ color: undefined })}
                  />
                  {EVENT_PALETTE.map((p) => (
                    <button
                      key={p.value}
                      className="swatch"
                      aria-pressed={ev.color === p.value}
                      aria-label={p.name}
                      style={{ background: p.value, opacity: !ev.color || ev.color === p.value ? 1 : 0.35 }}
                      onClick={() => patch({ color: p.value })}
                    />
                  ))}
                </span>
              </div>

              {/* description */}
              <div className="grow-item" style={{ alignItems: 'flex-start' }}>
                <span className="gicon" style={{ paddingTop: 2 }}>
                  <Notes size={22} />
                </span>
                <textarea
                  className="ginput"
                  placeholder="Add description"
                  rows={2}
                  value={ev.description ?? ''}
                  onChange={(e) => patch({ description: e.target.value || undefined })}
                />
              </div>
            </>
          )}

          {!isNew && onDelete && (
            <>
              <div className="gdiv" />
              <button className="grow-item gdelete" onClick={onDelete}>
                <span className="gicon" />
                <span className="glabel">Delete event</span>
              </button>
            </>
          )}
        </div>

        {/* notification menu — Google's None/30 min/…/Custom popover */}
        {notificationMenu && (
          <div className="gmenu-scrim" onClick={() => setNotificationMenu(null)}>
            <div className="gmenu" onClick={(e) => e.stopPropagation()}>
              {notificationMenu.target !== 'new' && (
                <button className="gmenu-item" onClick={() => applyNotificationChoice(null)}>
                  <span className="gmenu-check" />
                  None
                </button>
              )}
              {MENU_CHOICES.map((m) => {
                const active = notificationMenu.target === m;
                return (
                  <button key={m} className="gmenu-item" onClick={() => applyNotificationChoice(m)}>
                    <span className="gmenu-check">{active ? '✓' : ''}</span>
                    {alarmLabel(m)}
                  </button>
                );
              })}
              {!customOpen ? (
                <button className="gmenu-item" onClick={() => setCustomOpen(true)}>
                  <span className="gmenu-check" />
                  Custom…
                </button>
              ) : (
                <div className="gmenu-custom">
                  <input
                    type="number"
                    min={0}
                    autoFocus
                    placeholder="min"
                    value={customVal}
                    onChange={(e) => setCustomVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = parseInt(customVal, 10);
                        if (Number.isFinite(v) && v >= 0) applyNotificationChoice(v);
                        setCustomVal('');
                      }
                    }}
                  />
                  <span>minutes before</span>
                  <button
                    className="gmenu-ok"
                    onClick={() => {
                      const v = parseInt(customVal, 10);
                      if (Number.isFinite(v) && v >= 0) applyNotificationChoice(v);
                      setCustomVal('');
                    }}
                  >
                    OK
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
