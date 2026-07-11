import { useEffect, useState } from 'react';
import type { TaskItem, Recurrence } from '../types';
import {
  MS_HOUR,
  fmtOffset,
  startOfDay,
  toLocalDateValue,
} from '../lib/dates';
import { useStore } from '../state/store';
import { ensureAudioUnlocked } from '../alarm/sound';
import { useIsMobile } from '../hooks/useIsMobile';
import { BellFilled, CalIcon, Clock, Close, Notes, Repeat } from './icons';

interface Props {
  draft: TaskItem;
  isNew: boolean;
  onSave: (task: TaskItem) => void;
  onDelete?: () => void;
  onClose: () => void;
  /** switch a brand-new item over to the event editor (Google-style chips) */
  onSwitchToEvent?: () => void;
}

const QUICK_ALARMS = [5, 10, 15, 20, 30, 60, 1440];

type RecChoice = 'none' | 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

function recToChoice(r?: Recurrence): RecChoice {
  if (!r) return 'none';
  if (r.freq === 'WEEKLY' && r.byDay && r.byDay.length === 5) return 'WEEKDAYS';
  return r.freq;
}

function choiceToRec(c: RecChoice, due: number): Recurrence | undefined {
  switch (c) {
    case 'none':
      return undefined;
    case 'DAILY':
      return { freq: 'DAILY', interval: 1 };
    case 'WEEKDAYS':
      return { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5] };
    case 'WEEKLY':
      return { freq: 'WEEKLY', interval: 1, byDay: [new Date(due).getDay()] };
    case 'MONTHLY':
      return { freq: 'MONTHLY', interval: 1 };
    case 'YEARLY':
      return { freq: 'YEARLY', interval: 1 };
  }
}

function timeValue(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TaskEditor({ draft, isNew, onSave, onDelete, onClose, onSwitchToEvent }: Props) {
  const { state } = useStore();
  const isMobile = useIsMobile();
  const [task, setTask] = useState<TaskItem>(draft);
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

  const patch = (p: Partial<TaskItem>) => setTask((cur) => ({ ...cur, ...p }));

  const toggleAlarm = (minutes: number) => {
    ensureAudioUnlocked();
    setTask((cur) => ({
      ...cur,
      alarms: cur.alarms.includes(minutes)
        ? cur.alarms.filter((m) => m !== minutes)
        : [...cur.alarms, minutes].sort((a, b) => b - a),
    }));
  };

  const addCustomAlarm = () => {
    const m = parseInt(customAlarm, 10);
    if (!Number.isFinite(m) || m < 0 || m > 7 * 1440) return;
    if (!task.alarms.includes(m)) toggleAlarm(m);
    setCustomAlarm('');
  };

  const setHasTime = (hasTime: boolean) => {
    if (hasTime) {
      const d = startOfDay(task.due);
      d.setHours(9, 0, 0, 0);
      patch({ hasTime, due: d.getTime() });
    } else {
      patch({ hasTime, due: startOfDay(task.due).getTime() });
    }
  };

  const valid = task.title.trim().length > 0 && !!task.calendarId;

  const save = () => {
    if (!valid) return;
    ensureAudioUnlocked();
    onSave({ ...task, title: task.title.trim() });
  };

  const kindChips = isNew && onSwitchToEvent && (
    <div className="kind-chips">
      <button className="cal-chip" onClick={onSwitchToEvent}>
        Event
      </button>
      <button className="cal-chip" aria-pressed="true" style={{ ['--chip-color' as any]: 'var(--accent)' }}>
        Task
      </button>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={isNew ? 'New task' : 'Edit task'}>
        {isMobile ? (
          <div className="sheet-head">
            <button className="sheet-cancel" onClick={onClose}>
              Cancel
            </button>
            <span className="modal-title">{isNew ? 'New task' : 'Edit task'}</span>
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
            <h2 className="modal-title">{isNew ? 'New task' : 'Edit task'}</h2>
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <Close size={16} />
            </button>
          </div>
        )}

        <div className="modal-body">
          <input
            className="title-input"
            placeholder="Task name"
            value={task.title}
            autoFocus
            onChange={(e) => patch({ title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />

          {kindChips}

          <div className="field-row">
            <Clock size={16} />
            <input
              type="date"
              className="input grow"
              value={toLocalDateValue(task.due)}
              onChange={(e) => {
                const [y, m, d] = e.target.value.split('-').map(Number);
                if (!y) return;
                const cur = new Date(task.due);
                const next = new Date(y, m - 1, d, cur.getHours(), cur.getMinutes());
                patch({ due: next.getTime() });
              }}
            />
            {task.hasTime && (
              <input
                type="time"
                className="input"
                style={{ width: 110 }}
                value={timeValue(task.due)}
                onChange={(e) => {
                  const [h, mi] = e.target.value.split(':').map(Number);
                  if (!Number.isFinite(h)) return;
                  const d = startOfDay(task.due);
                  d.setHours(h, mi);
                  patch({ due: d.getTime() });
                }}
              />
            )}
          </div>

          <div className="field-row allday-toggle-row" style={{ paddingLeft: 28 }}>
            <label className="check-row">
              Give it a time (needed for alarms)
              <input
                type="checkbox"
                className="ios-switch"
                checked={task.hasTime}
                onChange={(e) => setHasTime(e.target.checked)}
              />
            </label>
          </div>

          <div className="field-row">
            <Repeat size={16} />
            <select
              className="input grow"
              value={recToChoice(task.recurrence)}
              onChange={(e) =>
                patch({ recurrence: choiceToRec(e.target.value as RecChoice, task.due), exceptions: undefined })
              }
            >
              <option value="none">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKDAYS">Every weekday (Mon–Fri)</option>
              <option value="WEEKLY">
                Weekly on {new Date(task.due).toLocaleDateString('en-GB', { weekday: 'long' })}
              </option>
              <option value="MONTHLY">Monthly on day {new Date(task.due).getDate()}</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </div>

          {task.hasTime && (
            <section className="alarm-section">
              <div className="alarm-section-head">
                <BellFilled size={14} />
                Alarms
              </div>
              <p className="alarm-section-sub">
                Not a notification — a real alarm that rings until you stop it.
              </p>
              <div className="alarm-chips">
                {[...new Set([...QUICK_ALARMS, ...task.alarms])]
                  .sort((a, b) => a - b)
                  .map((m) => {
                    const on = task.alarms.includes(m);
                    return (
                      <button key={m} className="chip-btn" aria-pressed={on} onClick={() => toggleAlarm(m)}>
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
                    aria-pressed={task.calendarId === c.id}
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
                value={task.calendarId}
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

          <div className="field-row" style={{ alignItems: 'flex-start' }}>
            <Notes size={16} />
            <textarea
              className="input grow"
              placeholder="Description"
              rows={2}
              value={task.description ?? ''}
              onChange={(e) => patch({ description: e.target.value || undefined })}
            />
          </div>

          {isMobile && !isNew && onDelete && (
            <button className="sheet-delete" onClick={onDelete}>
              Delete task
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

/** default new task: today, no time, default list = first writable calendar */
export function draftTask(calendarId: string, at?: number): TaskItem {
  const due = startOfDay(at ?? Date.now() + MS_HOUR).getTime();
  return {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    calendarId,
    title: '',
    due,
    hasTime: false,
    alarms: [],
  };
}
