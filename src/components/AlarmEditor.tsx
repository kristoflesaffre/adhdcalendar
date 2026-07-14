import { useEffect, useState } from 'react';
import type { AlarmClockItem } from '../types';
import { alarmAnchor, describeRepeatDays, fmtAlarmTime, hourGradient } from '../lib/alarmClocks';
import { ensureAudioUnlocked } from '../alarm/sound';
import { ClockWheel } from './TimeWheel';
import { ChevronDown, Notes } from './icons';

export type AlarmEditorMode = 'full' | 'options';

interface Props {
  alarm: AlarmClockItem;
  /** 'options' = repeat + label only (quick sheet); 'full' adds the time wheel */
  mode: AlarmEditorMode;
  isNew?: boolean;
  onSave: (alarm: AlarmClockItem) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** chip order follows the week (Mon-first), values stay 0=Sun…6=Sat */
const CHIP_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Bottom sheet in the cube language: wheel (full mode), day chips, a real
 *  label field, and a gradient Save that carries the alarm's hour color. */
export function AlarmEditor({ alarm, mode, isNew, onSave, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState<AlarmClockItem>(alarm);

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

  const toggleDay = (day: number) =>
    setDraft((cur) => ({
      ...cur,
      repeatDays: cur.repeatDays.includes(day)
        ? cur.repeatDays.filter((d) => d !== day)
        : [...cur.repeatDays, day].sort(),
    }));

  const setDays = (days: number[]) => setDraft((cur) => ({ ...cur, repeatDays: [...days] }));

  const sameDays = (days: number[]) =>
    draft.repeatDays.length === days.length && days.every((d) => draft.repeatDays.includes(d));

  const save = () => {
    ensureAudioUnlocked();
    onSave({
      ...draft,
      label: draft.label.trim(),
      enabled: true,
      anchor: alarmAnchor(draft.hour, draft.minute, draft.repeatDays),
    });
  };

  const g = hourGradient(draft.hour);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal gsheet alarm-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'options' ? 'Alarm options' : isNew ? 'Add alarm' : 'Edit alarm'}
      >
        <div className="gsheet-head">
          <button className="gsheet-cancel" onClick={onClose}>
            Cancel
          </button>
          <span className="gsheet-grab" aria-hidden="true">
            <ChevronDown size={22} />
          </span>
          <span className="gsheet-head-spacer" aria-hidden="true" />
        </div>

        <div className="gsheet-scroll">
          {mode === 'options' ? (
            <div
              className="alarm-sheet-time"
              style={{ ['--a1' as any]: g.a, ['--a2' as any]: g.b }}
            >
              {fmtAlarmTime(draft.hour, draft.minute)}
            </div>
          ) : (
            <div className="alarm-wheel-wrap">
              <ClockWheel
                hour={draft.hour}
                minute={draft.minute}
                onHour={(hour) => setDraft((cur) => ({ ...cur, hour }))}
                onMinute={(minute) => setDraft((cur) => ({ ...cur, minute }))}
              />
            </div>
          )}

          <div className="gdiv" />

          <div className="alarm-days-block">
            <div className="alarm-days-head">
              <span className="glabel">Repeat</span>
              <span className="alarm-days-summary">{describeRepeatDays(draft.repeatDays)}</span>
            </div>
            <div className="alarm-day-chips">
              {CHIP_ORDER.map((day) => (
                <button
                  key={day}
                  className={`alarm-day-chip${draft.repeatDays.includes(day) ? ' is-on' : ''}`}
                  aria-pressed={draft.repeatDays.includes(day)}
                  onClick={() => toggleDay(day)}
                >
                  {DAY_LETTERS[day]}
                </button>
              ))}
            </div>
            <div className="alarm-day-presets">
              <button
                className="cal-chip"
                aria-pressed={sameDays(WEEKDAYS)}
                onClick={() => setDays(sameDays(WEEKDAYS) ? [] : WEEKDAYS)}
              >
                Weekdays
              </button>
              <button
                className="cal-chip"
                aria-pressed={sameDays(ALL_DAYS)}
                onClick={() => setDays(sameDays(ALL_DAYS) ? [] : ALL_DAYS)}
              >
                Every day
              </button>
            </div>
          </div>

          <div className="gdiv" />

          <div className="alarm-label-block">
            <span className="glabel">Label</span>
            <div className="alarm-label-field">
              <Notes size={17} />
              <input
                placeholder="e.g. Wake up, Medication…"
                value={draft.label}
                onChange={(e) => setDraft((cur) => ({ ...cur, label: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </div>
          </div>

          {mode === 'full' && !isNew && onDelete && (
            <button className="alarm-delete" onClick={() => onDelete(draft.id)}>
              Delete alarm
            </button>
          )}

          <button
            className="alarm-save-btn"
            style={{ ['--a1' as any]: g.a, ['--a2' as any]: g.b }}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
