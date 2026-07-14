import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventItem, Recurrence } from '../types';
import { EVENT_PALETTE } from '../types';
import {
  addDays,
  addMonths,
  MS_DAY,
  MS_HOUR,
  fmtMonth,
  fmtOffset,
  fmtTime,
  isSameDay,
  minutesOfDay,
  setMinutesOfDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '../lib/dates';
import { useStore } from '../state/store';
import { ensureAudioUnlocked } from '../alarm/sound';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  CalIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Close,
  Notes,
  Palette,
  Pin,
  ReminderIcon,
  RingingBell,
} from './icons';

interface Props {
  draft: EventItem;
  isNew: boolean;
  onSave: (ev: EventItem) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** switch a brand-new item over to the task editor (Google-style chips) */
  onSwitchToTask?: () => void;
}

const QUICK_NOTIFICATIONS = [0, 5, 10, 15, 30, 60, 1440, 10080];
const ALARM_CHOICES = [0, 5, 10, 15];
const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, i) => i * 15);

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

function dateButtonLabel(t: number): string {
  return new Date(t).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function timeOptionLabel(minutes: number): string {
  const d = setMinutesOfDay(new Date(), minutes);
  return fmtTime(d);
}

function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})(?::|\.|h)?(\d{2})?$/i);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function closestTimeOption(minutes: number): number {
  return TIME_OPTIONS.reduce((closest, option) =>
    Math.abs(option - minutes) < Math.abs(closest - minutes) ? option : closest,
  TIME_OPTIONS[0]);
}

function parseDateInput(value: string, fallback: number): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const current = new Date(fallback);
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const parsed = new Date(year, month, day);
    if (parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day) {
      return parsed;
    }
    return null;
  }

  const numeric = trimmed.match(/^(\d{1,2})(?:[./-](\d{1,2}))?(?:[./-](\d{2,4}))?$/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = numeric[2] === undefined ? current.getMonth() : Number(numeric[2]) - 1;
    let year = numeric[3] === undefined ? current.getFullYear() : Number(numeric[3]);
    if (year < 100) year += 2000;
    const parsed = new Date(year, month, day);
    if (parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day) {
      return parsed;
    }
    return null;
  }

  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const words = trimmed
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter((part) => !['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(part));
  const dayIndex = words.findIndex((part) => /^\d{1,2}$/.test(part));
  const monthIndex = words.findIndex((part) => monthNames.some((month) => month.startsWith(part)));
  if (dayIndex !== -1 && monthIndex !== -1) {
    const day = Number(words[dayIndex]);
    const month = monthNames.findIndex((monthName) => monthName.startsWith(words[monthIndex]));
    const explicitYear = words.find((part) => /^\d{4}$/.test(part));
    const year = explicitYear ? Number(explicitYear) : current.getFullYear();
    const parsed = new Date(year, month, day);
    if (parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day) {
      return parsed;
    }
    return null;
  }

  const natural = new Date(trimmed);
  return Number.isFinite(natural.getTime()) ? natural : null;
}

function InlineDatePicker({
  value,
  weekStartsOn,
  onChange,
}: {
  value: number;
  weekStartsOn: 0 | 1;
  onChange: (day: Date) => void;
}) {
  const selected = startOfDay(value);
  const [cursor, setCursor] = useState(() => startOfMonth(selected));

  useEffect(() => {
    setCursor(startOfMonth(selected));
  }, [selected.getFullYear(), selected.getMonth()]);

  const gridStart = startOfWeek(cursor, weekStartsOn);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const dows = Array.from({ length: 7 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="desktop-date-picker" onMouseDown={(e) => e.preventDefault()}>
      <div className="desktop-date-head">
        <strong>{fmtMonth(cursor)}</strong>
        <span>
          <button className="icon-btn" aria-label="Previous month" onClick={() => setCursor(addMonths(cursor, -1))}>
            <ChevronLeft size={16} />
          </button>
          <button className="icon-btn" aria-label="Next month" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight size={16} />
          </button>
        </span>
      </div>
      <div className="desktop-date-grid">
        {dows.map((d) => (
          <div key={d.getTime()} className="desktop-date-dow">
            {d.toLocaleDateString('en-GB', { weekday: 'narrow' })}
          </div>
        ))}
        {cells.map((d) => {
          const out = d.getMonth() !== cursor.getMonth();
          const selectedDay = isSameDay(d, selected);
          return (
            <button
              key={d.getTime()}
              className={`desktop-date-cell${out ? ' is-out' : ''}${selectedDay ? ' is-selected' : ''}`}
              onClick={() => onChange(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeMenu({
  value,
  onChange,
}: {
  value: number;
  onChange: (minutes: number) => void;
}) {
  const selected = closestTimeOption(value);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selectedButton = menuRef.current?.querySelector<HTMLButtonElement>('[data-selected="true"]');
    selectedButton?.scrollIntoView({ block: 'center' });
  }, [selected]);

  return (
    <div className="desktop-time-menu" role="menu" ref={menuRef}>
      {TIME_OPTIONS.map((minutes) => (
        <button
          key={minutes}
          className={minutes === selected ? 'is-selected' : ''}
          data-selected={minutes === selected ? 'true' : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(minutes)}
        >
          {timeOptionLabel(minutes)}
        </button>
      ))}
    </div>
  );
}

export function EventEditor({ draft, isNew, onSave, onDelete, onClose, onSwitchToTask }: Props) {
  const { state } = useStore();
  const isMobile = useIsMobile();
  const [ev, setEv] = useState<EventItem>(draft);
  const [customNotification, setCustomNotification] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [timeMenu, setTimeMenu] = useState<null | 'start' | 'end'>(null);
  const [dateText, setDateText] = useState(() => dateButtonLabel(draft.start));
  const [startTimeText, setStartTimeText] = useState(() => fmtTime(draft.start));
  const [endTimeText, setEndTimeText] = useState(() => fmtTime(draft.end));
  const writableCals = state.calendars.filter((c) => !c.readOnly);
  const selectedCalendar = useMemo(
    () => state.calendars.find((c) => c.id === ev.calendarId),
    [state.calendars, ev.calendarId],
  );
  const startMinutes = minutesOfDay(ev.start);
  const endMinutes = minutesOfDay(ev.end);
  const startMenuMinutes = parseTimeInput(startTimeText) ?? startMinutes;
  const endMenuMinutes = parseTimeInput(endTimeText) ?? endMinutes;

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

  useEffect(() => {
    if (!dateOpen) setDateText(dateButtonLabel(ev.start));
    if (timeMenu !== 'start') setStartTimeText(fmtTime(ev.start));
    if (timeMenu !== 'end') setEndTimeText(fmtTime(ev.end));
  }, [dateOpen, ev.start, ev.end, timeMenu]);

  const patch = (p: Partial<EventItem>) => setEv((cur) => ({ ...cur, ...p }));

  const toggleAlarm = (minutes: number) => {
    ensureAudioUnlocked(); // any editor interaction unlocks audio for later ringing
    setEv((cur) => ({
      ...cur,
      alarms: cur.alarms.includes(minutes)
        ? cur.alarms.filter((m) => m !== minutes)
        : [...cur.alarms, minutes].sort((a, b) => b - a),
    }));
  };

  const toggleNotification = (minutes: number) => {
    setEv((cur) => ({
      ...cur,
      notifications: cur.notifications.includes(minutes)
        ? cur.notifications.filter((m) => m !== minutes)
        : [...cur.notifications, minutes].sort((a, b) => b - a),
    }));
  };

  const addCustomNotification = () => {
    const m = parseInt(customNotification, 10);
    if (!Number.isFinite(m) || m < 0 || m > 7 * 1440) return;
    if (!ev.notifications.includes(m)) toggleNotification(m);
    setCustomNotification('');
  };

  const setDate = (day: Date) => {
    const s = setMinutesOfDay(day, minutesOfDay(ev.start)).getTime();
    setDateText(dateButtonLabel(s));
    patch({ start: s, end: s + (ev.end - ev.start) });
    setDateOpen(false);
  };

  const commitTypedDate = () => {
    const day = parseDateInput(dateText, ev.start);
    if (!day) {
      setDateText(dateButtonLabel(ev.start));
      setDateOpen(false);
      return;
    }
    setDate(day);
  };

  const setStartMinutes = (minutes: number) => {
    const nextStart = setMinutesOfDay(ev.start, minutes).getTime();
    const dur = ev.end - ev.start;
    setStartTimeText(timeOptionLabel(minutes));
    setEndTimeText(fmtTime(nextStart + dur));
    patch({ start: nextStart, end: nextStart + dur });
    setTimeMenu(null);
  };

  const setEndMinutes = (minutes: number) => {
    let nextEnd = setMinutesOfDay(ev.start, minutes).getTime();
    if (nextEnd <= ev.start) nextEnd += MS_DAY;
    setEndTimeText(fmtTime(nextEnd));
    patch({ end: nextEnd });
    setTimeMenu(null);
  };

  const commitTypedTime = (field: 'start' | 'end') => {
    const text = field === 'start' ? startTimeText : endTimeText;
    const minutes = parseTimeInput(text);
    if (minutes === null) {
      if (field === 'start') setStartTimeText(fmtTime(ev.start));
      else setEndTimeText(fmtTime(ev.end));
      return;
    }
    if (field === 'start') setStartMinutes(minutes);
    else setEndMinutes(minutes);
  };

  const setAllDay = (allDay: boolean) => {
    if (allDay) {
      const s = startOfDay(ev.start).getTime();
      patch({ allDay, start: s, end: Math.max(startOfDay(ev.end - 1).getTime() + MS_DAY, s + MS_DAY) });
    } else {
      const s = startOfDay(ev.start).getTime() + 9 * MS_HOUR;
      patch({ allDay, start: s, end: s + MS_HOUR });
    }
  };

  const valid = ev.end > ev.start && ev.calendarId;

  const save = () => {
    if (!valid) return;
    ensureAudioUnlocked();
    onSave({ ...ev, title: ev.title.trim() });
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal event-quick-modal" role="dialog" aria-modal="true" aria-label={isNew ? 'New event' : 'Edit event'}>
        {isMobile ? (
          <div className="sheet-head">
            <button className="sheet-cancel" onClick={onClose}>
              Cancel
            </button>
            <span className="modal-title">{isNew ? 'New event' : 'Edit event'}</span>
            <button
              className="btn sheet-save"
              onClick={save}
              disabled={!valid}
              style={!valid ? { opacity: 0.5 } : undefined}
            >
              Save
            </button>
          </div>
        ) : (
          <div className="event-quick-head">
            <Notes size={22} />
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <Close size={22} />
            </button>
          </div>
        )}

        <div className="modal-body event-quick-body">
          <input
            className="title-input event-quick-title"
            placeholder="Add title"
            value={ev.title}
            autoFocus
            onChange={(e) => patch({ title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />

          {isNew && onSwitchToTask && (
            <div className="event-kind-tabs">
              <button
                className="event-kind-tab is-active"
                aria-pressed="true"
              >
                Event
              </button>
              <button className="event-kind-tab" onClick={onSwitchToTask}>
                Task
              </button>
              <button className="event-kind-tab" disabled>
                Appointment schedule
              </button>
            </div>
          )}

          <div className="event-widget-row event-time-widget">
            <Clock size={22} />
            <div className="event-widget-main">
              <div className="event-date-time-line">
                <span className="event-popover-wrap">
                  <input
                    className={`event-gray-chip event-date-chip${dateOpen ? ' is-open' : ''}`}
                    value={dateText}
                    aria-label="Event date"
                    onFocus={(e) => {
                      e.currentTarget.select();
                      setDateOpen(true);
                      setTimeMenu(null);
                    }}
                    onChange={(e) => setDateText(e.target.value)}
                    onBlur={commitTypedDate}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitTypedDate();
                      }
                    }}
                  />
                  {dateOpen && (
                    <InlineDatePicker
                      value={ev.start}
                      weekStartsOn={state.settings.weekStartsOn}
                      onChange={setDate}
                    />
                  )}
                </span>
                {!ev.allDay && (
                  <>
                    <span className="event-popover-wrap">
                      <input
                        className={`event-gray-chip event-time-chip${timeMenu === 'start' ? ' is-open' : ''}`}
                        value={startTimeText}
                        inputMode="numeric"
                        aria-label="Start time"
                        onFocus={(e) => {
                          e.currentTarget.select();
                          setTimeMenu('start');
                          setDateOpen(false);
                        }}
                        onChange={(e) => setStartTimeText(e.target.value)}
                        onBlur={() => commitTypedTime('start')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitTypedTime('start');
                          }
                        }}
                      />
                      {timeMenu === 'start' && <TimeMenu value={startMenuMinutes} onChange={setStartMinutes} />}
                    </span>
                    <span className="event-time-dash">–</span>
                    <span className="event-popover-wrap">
                      <input
                        className={`event-gray-chip event-time-chip${timeMenu === 'end' ? ' is-open' : ''}`}
                        value={endTimeText}
                        inputMode="numeric"
                        aria-label="End time"
                        onFocus={(e) => {
                          e.currentTarget.select();
                          setTimeMenu('end');
                          setDateOpen(false);
                        }}
                        onChange={(e) => setEndTimeText(e.target.value)}
                        onBlur={() => commitTypedTime('end')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitTypedTime('end');
                          }
                        }}
                      />
                      {timeMenu === 'end' && <TimeMenu value={endMenuMinutes} onChange={setEndMinutes} />}
                    </span>
                  </>
                )}
              </div>
              <div className="event-time-options">
                <label className="event-check">
                  <input
                    type="checkbox"
                    checked={ev.allDay}
                    onChange={(e) => setAllDay(e.target.checked)}
                  />
                  <span>All day</span>
                </label>
                <button className="event-link" type="button">Time zone</button>
                <label className="event-select-chip">
                  <select
                    value={recToChoice(ev.recurrence)}
                    onChange={(e) =>
                      patch({ recurrence: choiceToRec(e.target.value as RecChoice, ev.start), exceptions: undefined })
                    }
                  >
                    <option value="none">Does not repeat</option>
                    <option value="DAILY">Daily</option>
                    <option value="WEEKDAYS">Every weekday (Mon–Fri)</option>
                    <option value="WEEKLY">Weekly on {new Date(ev.start).toLocaleDateString('en-GB', { weekday: 'long' })}</option>
                    <option value="MONTHLY">Monthly on day {new Date(ev.start).getDate()}</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                  <ChevronDown size={16} />
                </label>
              </div>
            </div>
          </div>

          <label className="event-widget-row">
            <Pin size={22} />
            <input
              className="event-row-input"
              placeholder="Add location"
              value={ev.location ?? ''}
              onChange={(e) => patch({ location: e.target.value || undefined })}
            />
          </label>

          <label className="event-widget-row event-description-row">
            <Notes size={22} />
            <textarea
              className="event-row-input"
              placeholder="Add description or attachment"
              rows={2}
              value={ev.description ?? ''}
              onChange={(e) => patch({ description: e.target.value || undefined })}
            />
          </label>

          <div className="event-widget-row event-calendar-row">
            <CalIcon size={22} />
            <div className="event-widget-main">
              <label className="event-calendar-select">
                <select
                  value={ev.calendarId}
                  onChange={(e) => patch({ calendarId: e.target.value })}
                >
                  {writableCals.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="dot" style={{ background: selectedCalendar?.color }} />
              </label>
              <div className="event-calendar-sub">
                Busy · Default visibility · {ev.notifications.length} notification{ev.notifications.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="event-widget-row event-color-row">
            <Palette size={22} />
            <div className="swatches">
              <button
                className="swatch"
                aria-pressed={!ev.color}
                aria-label="Calendar color"
                title="Use calendar color"
                style={{
                  background: selectedCalendar?.color,
                  opacity: 0.45,
                }}
                onClick={() => patch({ color: undefined })}
              />
              {EVENT_PALETTE.map((p) => (
                <button
                  key={p.value}
                  className="swatch"
                  aria-pressed={ev.color === p.value}
                  aria-label={p.name}
                  title={p.name}
                  style={{ background: p.value }}
                  onClick={() => patch({ color: p.value })}
                />
              ))}
            </div>
          </div>

          {!ev.allDay && (
            <div className="event-widget-row event-reminder-row">
              <ReminderIcon size={22} />
              <div className="event-widget-main">
                <div className="event-row-title">Notifications</div>
                <div className="alarm-chips">
                  {[...new Set([...QUICK_NOTIFICATIONS, ...ev.notifications])]
                    .sort((a, b) => a - b)
                    .map((m) => {
                      const on = ev.notifications.includes(m);
                      return (
                        <button
                          key={m}
                          className="chip-btn"
                          aria-pressed={on}
                          onClick={() => toggleNotification(m)}
                        >
                          {fmtOffset(m)}
                          {on && <span className="x">×</span>}
                        </button>
                      );
                    })}
                  <span className="custom-alarm">
                    <input
                      type="number"
                      min={0}
                      placeholder="min"
                      value={customNotification}
                      onChange={(e) => setCustomNotification(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomNotification();
                        }
                      }}
                      aria-label="Custom notification, minutes before"
                    />
                    <button className="chip-btn" onClick={addCustomNotification}>
                      + Add
                    </button>
                  </span>
                </div>
              </div>
            </div>
          )}

          {!ev.allDay && (
            <div className="event-widget-row event-reminder-row">
              <RingingBell size={22} />
              <div className="event-widget-main">
                <div className="event-row-title">Alarm</div>
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
          )}

          {isMobile && !isNew && onDelete && (
            <button className="sheet-delete" onClick={onDelete}>
              Delete event
            </button>
          )}
        </div>

        {!isMobile && (
          <div className="modal-foot">
            <span>
              {!isNew && onDelete && (
                <button className="btn btn-danger" onClick={onDelete}>
                  Delete
                </button>
              )}
            </span>
            <span className="right">
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn" onClick={save} disabled={!valid} style={!valid ? { opacity: 0.5 } : undefined}>
                Save
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
