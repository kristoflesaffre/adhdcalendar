import { useEffect, useState } from 'react';
import type { EventItem, Recurrence } from '../types';
import { EVENT_PALETTE } from '../types';
import {
  MS_DAY,
  MS_HOUR,
  fmtOffset,
  fromLocalInputValue,
  startOfDay,
  toLocalDateValue,
  toLocalInputValue,
} from '../lib/dates';
import { useStore } from '../state/store';
import { ensureAudioUnlocked } from '../alarm/sound';
import { useIsMobile } from '../hooks/useIsMobile';
import { BellFilled, CalIcon, Clock, Close, Notes, Palette, Pin, Repeat } from './icons';

interface Props {
  draft: EventItem;
  isNew: boolean;
  onSave: (ev: EventItem) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** switch a brand-new item over to the task editor (Google-style chips) */
  onSwitchToTask?: () => void;
}

const QUICK_ALARMS = [5, 10, 15, 20, 30, 60, 1440];

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

export function EventEditor({ draft, isNew, onSave, onDelete, onClose, onSwitchToTask }: Props) {
  const { state } = useStore();
  const isMobile = useIsMobile();
  const [ev, setEv] = useState<EventItem>(draft);
  const [customAlarm, setCustomAlarm] = useState('');
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

  const toggleAlarm = (minutes: number) => {
    ensureAudioUnlocked(); // any editor interaction unlocks audio for later ringing
    setEv((cur) => ({
      ...cur,
      alarms: cur.alarms.includes(minutes)
        ? cur.alarms.filter((m) => m !== minutes)
        : [...cur.alarms, minutes].sort((a, b) => b - a),
    }));
  };

  const addCustomAlarm = () => {
    const m = parseInt(customAlarm, 10);
    if (!Number.isFinite(m) || m < 0 || m > 7 * 1440) return;
    if (!ev.alarms.includes(m)) toggleAlarm(m);
    setCustomAlarm('');
  };

  const setStart = (t: number) => {
    const dur = ev.end - ev.start;
    patch({ start: t, end: t + dur });
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
      <div className="modal" role="dialog" aria-modal="true" aria-label={isNew ? 'New event' : 'Edit event'}>
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
          <div className="modal-head">
            <h2 className="modal-title">{isNew ? 'New event' : 'Edit event'}</h2>
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <Close size={16} />
            </button>
          </div>
        )}

        <div className="modal-body">
          <input
            className="title-input"
            placeholder="Add a title"
            value={ev.title}
            autoFocus
            onChange={(e) => patch({ title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />

          {isNew && onSwitchToTask && (
            <div className="kind-chips">
              <button
                className="cal-chip"
                aria-pressed="true"
                style={{ ['--chip-color' as any]: 'var(--accent)' }}
              >
                Event
              </button>
              <button className="cal-chip" onClick={onSwitchToTask}>
                Task
              </button>
            </div>
          )}

          <div className="field-row">
            <Clock size={16} />
            {ev.allDay ? (
              <>
                <input
                  type="date"
                  className="input grow"
                  value={toLocalDateValue(ev.start)}
                  onChange={(e) => {
                    const s = new Date(e.target.value).getTime();
                    if (Number.isFinite(s)) patch({ start: s, end: Math.max(ev.end - ev.start, MS_DAY) + s });
                  }}
                />
                <span style={{ color: 'var(--muted)' }}>to</span>
                <input
                  type="date"
                  className="input grow"
                  value={toLocalDateValue(ev.end - 1)}
                  onChange={(e) => {
                    const d = new Date(e.target.value).getTime();
                    if (Number.isFinite(d)) patch({ end: Math.max(d + MS_DAY, ev.start + MS_DAY) });
                  }}
                />
              </>
            ) : (
              <>
                <input
                  type="datetime-local"
                  className="input grow"
                  value={toLocalInputValue(ev.start)}
                  onChange={(e) => {
                    const t = fromLocalInputValue(e.target.value);
                    if (Number.isFinite(t)) setStart(t);
                  }}
                />
                <span style={{ color: 'var(--muted)' }}>to</span>
                <input
                  type="datetime-local"
                  className="input grow"
                  value={toLocalInputValue(ev.end)}
                  min={toLocalInputValue(ev.start)}
                  onChange={(e) => {
                    const t = fromLocalInputValue(e.target.value);
                    if (Number.isFinite(t) && t > ev.start) patch({ end: t });
                  }}
                />
              </>
            )}
          </div>

          <div className="field-row allday-toggle-row" style={{ paddingLeft: 28 }}>
            <label className="check-row">
              All day
              <input
                type="checkbox"
                className="ios-switch"
                checked={ev.allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
            </label>
          </div>

          <div className="field-row">
            <Repeat size={16} />
            <select
              className="input grow"
              value={recToChoice(ev.recurrence)}
              onChange={(e) => patch({ recurrence: choiceToRec(e.target.value as RecChoice, ev.start), exceptions: undefined })}
            >
              <option value="none">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKDAYS">Every weekday (Mon–Fri)</option>
              <option value="WEEKLY">Weekly on {new Date(ev.start).toLocaleDateString('en-GB', { weekday: 'long' })}</option>
              <option value="MONTHLY">Monthly on day {new Date(ev.start).getDate()}</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </div>

          {/* ——— the signature: real alarms ——— */}
          {!ev.allDay && (
            <section className="alarm-section">
              <div className="alarm-section-head">
                <BellFilled size={14} />
                Alarms
              </div>
              <p className="alarm-section-sub">
                Not a notification — a real alarm that rings until you stop it. Add as many as you need.
              </p>
              <div className="alarm-chips">
                {[...new Set([...QUICK_ALARMS, ...ev.alarms])]
                  .sort((a, b) => a - b)
                  .map((m) => {
                    const on = ev.alarms.includes(m);
                    return (
                      <button
                        key={m}
                        className="chip-btn"
                        aria-pressed={on}
                        onClick={() => toggleAlarm(m)}
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
                    value={customAlarm}
                    onChange={(e) => setCustomAlarm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomAlarm();
                      }
                    }}
                    aria-label="Custom alarm, minutes before"
                  />
                  <button className="chip-btn" onClick={addCustomAlarm}>
                    + Add
                  </button>
                </span>
              </div>
            </section>
          )}

          <div className="field-row">
            <CalIcon size={16} />
            {isMobile ? (
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
            ) : (
              <select
                className="input grow"
                value={ev.calendarId}
                onChange={(e) => patch({ calendarId: e.target.value })}
              >
                {writableCals.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="field-row">
            <Palette size={16} />
            <div className="swatches">
              <button
                className="swatch"
                aria-pressed={!ev.color}
                aria-label="Calendar color"
                title="Use calendar color"
                style={{
                  background: state.calendars.find((c) => c.id === ev.calendarId)?.color,
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

          <div className="field-row">
            <Pin size={16} />
            <input
              className="input grow"
              placeholder="Add location"
              value={ev.location ?? ''}
              onChange={(e) => patch({ location: e.target.value || undefined })}
            />
          </div>

          <div className="field-row" style={{ alignItems: 'flex-start' }}>
            <Notes size={16} />
            <textarea
              className="input grow"
              placeholder="Add description"
              rows={2}
              value={ev.description ?? ''}
              onChange={(e) => patch({ description: e.target.value || undefined })}
            />
          </div>

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
