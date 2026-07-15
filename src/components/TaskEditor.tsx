import { useEffect, useRef, useState } from 'react';
import type { Recurrence, TaskItem } from '../types';
import { MS_HOUR, startOfDay } from '../lib/dates';
import { useStore } from '../state/store';
import { ensureAudioUnlocked } from '../alarm/sound';
import { MiniMonth } from './MiniMonth';
import { ClockWheel } from './TimeWheel';
import { Camera, ChevronRight, Clock, Close, Notes, ReminderIcon, Repeat, RingingBell } from './icons';

/**
 * Task editor in the same Claude Design language as EventSheet
 * ("ADHD Calendar - New Event.dc.html"): pill Save button, title row with a
 * calendar-colour dot, segmented Event/Task control, grouped inset cards,
 * and the highlighted Alarm card with a chip swimlane.
 */

interface Props {
  draft: TaskItem;
  isNew: boolean;
  onSave: (task: TaskItem) => void;
  onDelete?: () => void;
  onClose: () => void;
  onSwitchToEvent?: () => void;
}

const NOTIFICATION_CHOICES = [0, 10, 30, 60, 1440, 10080];
const ALARM_CHIP_CHOICES = [0, 5, 10, 15, 30, 60];

type RecChoice = 'none' | 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

const REC_LABELS: Record<RecChoice, string> = {
  none: 'Never',
  DAILY: 'Daily',
  WEEKDAYS: 'Weekdays',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
};

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

const fmtRowDate = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

function notificationLabel(minutes: number): string {
  if (minutes === 0) return 'At time of task';
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes > 10080 ? 's' : ''} before`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes > 1440 ? 's' : ''} before`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes > 60 ? 's' : ''} before`;
  return `${minutes} minutes before`;
}

/** Short chip label for the alarm swimlane: "At start", "5 min", "1 hour" */
function alarmChipLabel(m: number): string {
  if (m === 0) return 'At start';
  if (m % 60 === 0) return m === 60 ? '1 hour' : `${m / 60} hours`;
  return `${m} min`;
}

async function compressScreenshot(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.onload = () => resolve(next);
    next.onerror = reject;
    next.src = source;
  });
  const maxEdge = 1400;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

export function TaskEditor({ draft, isNew, onSave, onDelete, onClose, onSwitchToEvent }: Props) {
  const { state } = useStore();
  const [task, setTask] = useState<TaskItem>(draft);
  const [notificationMenu, setNotificationMenu] = useState<null | { target: number | 'new' }>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const [alarmCustomOpen, setAlarmCustomOpen] = useState(false);
  const [alarmCustomVal, setAlarmCustomVal] = useState('');
  const [expanded, setExpanded] = useState<null | 'date' | 'time'>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const writableCalendars = state.calendars.filter((calendar) => !calendar.readOnly);
  const sortedNotifications = [...task.notifications].sort((a, b) => a - b);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (notificationMenu) setNotificationMenu(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [notificationMenu, onClose]);

  const patch = (next: Partial<TaskItem>) => setTask((current) => ({ ...current, ...next }));

  const toggleExpand = (which: 'date' | 'time') => setExpanded((cur) => (cur === which ? null : which));

  const setHasTime = (hasTime: boolean) => {
    setExpanded(null);
    if (hasTime) {
      const due = startOfDay(task.due);
      due.setHours(9, 0, 0, 0);
      patch({ hasTime, due: due.getTime() });
    } else {
      patch({ hasTime, due: startOfDay(task.due).getTime() });
    }
  };

  const toggleAlarm = (minutes: number) => {
    ensureAudioUnlocked();
    setTask((current) => ({
      ...current,
      alarms: current.alarms.includes(minutes)
        ? current.alarms.filter((value) => value !== minutes)
        : [...current.alarms, minutes].sort((a, b) => a - b),
    }));
  };

  const addCustomAlarm = () => {
    const v = parseInt(alarmCustomVal, 10);
    setAlarmCustomVal('');
    setAlarmCustomOpen(false);
    if (Number.isFinite(v) && v >= 0 && !task.alarms.includes(v)) toggleAlarm(v);
  };

  const alarmChips = [...new Set([...ALARM_CHIP_CHOICES, ...task.alarms])].sort((a, b) => a - b);

  const applyNotification = (minutes: number | null) => {
    const menu = notificationMenu;
    setNotificationMenu(null);
    setCustomOpen(false);
    if (!menu) return;
    setTask((current) => {
      let notifications = [...current.notifications];
      if (menu.target === 'new') {
        if (minutes !== null && !notifications.includes(minutes)) notifications.push(minutes);
      } else {
        notifications = notifications.filter((value) => value !== menu.target);
        if (minutes !== null && !notifications.includes(minutes)) notifications.push(minutes);
      }
      return { ...current, notifications: notifications.sort((a, b) => b - a) };
    });
  };

  const activeCal = state.calendars.find((c) => c.id === task.calendarId);

  const valid = task.title.trim().length > 0 && !!task.calendarId;
  const save = () => {
    if (!valid) return;
    ensureAudioUnlocked();
    onSave({ ...task, title: task.title.trim() });
  };

  return (
    <div className="modal-backdrop task-modal-backdrop">
      <div
        className="modal task-modal gsheet-v2"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'New task' : 'Edit task'}
      >
        <div className="task-sheet-head">
          <button className="gsheet-cancel" onClick={onClose}>
            Cancel
          </button>
          <strong>{isNew ? 'New task' : 'Edit task'}</strong>
          <button className="gs-save-pill" onClick={save} disabled={!valid}>
            Save
          </button>
        </div>

        <div className="task-sheet-scroll">
          {/* title + Event/Task segmented control */}
          <div className="gs-title-block">
            <div className="gs-title-row">
              <span className="gs-title-dot" style={{ background: activeCal?.color }} aria-hidden="true" />
              <input
                className="gsheet-title"
                placeholder="Add title"
                value={task.title}
                autoFocus={isNew}
                onChange={(event) => patch({ title: event.target.value })}
                onKeyDown={(event) => event.key === 'Enter' && save()}
              />
            </div>
            {isNew && onSwitchToEvent && (
              <div className="gs-seg" role="tablist" aria-label="Entry type">
                <button className="gs-seg-btn" role="tab" aria-selected="false" onClick={onSwitchToEvent}>
                  Event
                </button>
                <button className="gs-seg-btn is-active" role="tab" aria-selected="true">
                  Task
                </button>
              </div>
            )}
          </div>

          {/* calendar chips */}
          <div className="gs-chip-lane">
            {writableCalendars.map((calendar) => (
              <button
                key={calendar.id}
                className="gs-cal-chip"
                aria-pressed={task.calendarId === calendar.id}
                style={{ ['--chip-color' as any]: calendar.color }}
                onClick={() => patch({ calendarId: calendar.id })}
              >
                <span className="dot" style={{ background: calendar.color }} />
                {calendar.name}
              </button>
            ))}
          </div>

          {/* when card */}
          <div className="gs-card">
            <div className="gs-row">
              <span className="gs-ic">
                <Clock size={20} />
              </span>
              <span className="gs-label">All day</span>
              <input
                type="checkbox"
                className="ios-switch"
                checked={!task.hasTime}
                onChange={(event) => setHasTime(!event.target.checked)}
                aria-label="All day"
              />
            </div>
            <div className="gs-sep" />
            <div className="gs-row">
              <span className="gs-ic" />
              <button
                className={`gs-date-chip${expanded === 'date' ? ' is-open' : ''}`}
                onClick={() => toggleExpand('date')}
              >
                {fmtRowDate(task.due)}
              </button>
              <span className="gs-flex" />
              {task.hasTime && (
                <button
                  className={`gs-time-chip is-start${expanded === 'time' ? ' is-open' : ''}`}
                  onClick={() => toggleExpand('time')}
                >
                  {timeValue(task.due)}
                </button>
              )}
            </div>
            {expanded === 'date' && (
              <div className="gs-inline">
                <MiniMonth
                  selected={new Date(task.due)}
                  onSelect={(d) => {
                    const current = new Date(task.due);
                    const next = new Date(d);
                    next.setHours(current.getHours(), current.getMinutes(), 0, 0);
                    patch({ due: next.getTime() });
                  }}
                  weekStartsOn={state.settings.weekStartsOn}
                  busyDays={new Set()}
                />
              </div>
            )}
            {expanded === 'time' && task.hasTime && (
              <div className="gs-inline">
                <ClockWheel
                  hour={new Date(task.due).getHours()}
                  minute={new Date(task.due).getMinutes()}
                  onHour={(hour) => {
                    const due = new Date(task.due);
                    due.setHours(hour);
                    patch({ due: due.getTime() });
                  }}
                  onMinute={(minute) => {
                    const due = new Date(task.due);
                    due.setMinutes(minute);
                    patch({ due: due.getTime() });
                  }}
                />
              </div>
            )}
          </div>

          {/* details card: details · repeat · screenshot */}
          <div className="gs-card">
            <div className="gs-row" style={{ alignItems: 'flex-start' }}>
              <span className="gs-ic" style={{ paddingTop: 2 }}>
                <Notes size={20} />
              </span>
              <textarea
                className="gs-input"
                placeholder="Add details"
                rows={2}
                value={task.description ?? ''}
                onChange={(event) => patch({ description: event.target.value || undefined })}
              />
            </div>
            <div className="gs-sep" />
            <div className="gs-row gs-repeat">
              <span className="gs-ic">
                <Repeat size={20} />
              </span>
              <span className="gs-label">Repeat</span>
              <span className="gs-value">{REC_LABELS[recToChoice(task.recurrence)]}</span>
              <span className="gs-chev" aria-hidden="true">
                <ChevronRight size={16} />
              </span>
              <select
                className="gs-select-overlay"
                aria-label="Repeat"
                value={recToChoice(task.recurrence)}
                onChange={(event) =>
                  patch({
                    recurrence: choiceToRec(event.target.value as RecChoice, task.due),
                    exceptions: undefined,
                  })
                }
              >
                <option value="none">Never</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKDAYS">Every weekday (Mon-Fri)</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </div>
            <div className="gs-sep" />
            <div className="gs-row task-screenshot-row" style={{ alignItems: 'flex-start' }}>
              <span className="gs-ic" style={{ paddingTop: 2 }}>
                <Camera size={20} />
              </span>
              <div className="task-screenshot-body">
                <button className="task-screenshot-action" onClick={() => fileRef.current?.click()}>
                  {task.screenshot ? 'Replace screenshot' : 'Add screenshot'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) patch({ screenshot: await compressScreenshot(file) });
                    event.target.value = '';
                  }}
                />
                {task.screenshot && (
                  <figure className="task-screenshot-preview">
                    <img src={task.screenshot} alt="Task screenshot" />
                    <button aria-label="Remove screenshot" onClick={() => patch({ screenshot: undefined })}>
                      <Close size={16} />
                    </button>
                  </figure>
                )}
              </div>
            </div>
          </div>

          {task.hasTime && (
            <>
              {/* standard notifications */}
              <div className="gs-section-label">Notifications</div>
              <div className="gs-card">
                {sortedNotifications.map((minutes, index) => (
                  <span key={minutes} style={{ display: 'contents' }}>
                    {index > 0 && <div className="gs-sep" />}
                    <button className="gs-row gs-tap" onClick={() => setNotificationMenu({ target: minutes })}>
                      <span className="gs-ic">{index === 0 ? <ReminderIcon size={21} /> : null}</span>
                      <span className="gs-label">{notificationLabel(minutes)}</span>
                      <span className="gs-chev">
                        <ChevronRight size={16} />
                      </span>
                    </button>
                  </span>
                ))}
                {sortedNotifications.length > 0 && <div className="gs-sep" />}
                <button className="gs-row gs-tap" onClick={() => setNotificationMenu({ target: 'new' })}>
                  <span className="gs-ic">
                    {sortedNotifications.length === 0 ? <ReminderIcon size={21} /> : null}
                  </span>
                  <span className="gs-label gs-muted">Add notification</span>
                  <span className="gs-chev">
                    <ChevronRight size={16} />
                  </span>
                </button>
              </div>

              {/* the alarm — same promoted card as the event sheet */}
              <div className="gs-section-label is-alarm">Alarm</div>
              <div className="gs-alarm-card">
                <div className="gs-alarm-head">
                  <span className="gs-alarm-bell" aria-hidden="true">
                    <span className="gs-alarm-ring" />
                    <RingingBell size={20} />
                  </span>
                  <div className="gs-alarm-copy">
                    <div className="gs-alarm-title">Rings until you stop it</div>
                    <div className="gs-alarm-sub">A real alarm — even when your phone is on silent.</div>
                  </div>
                </div>
                <div className="gs-alarm-lane" role="group" aria-label="Alarm times">
                  {alarmChips.map((minutes) => {
                    const active = task.alarms.includes(minutes);
                    return (
                      <button
                        key={minutes}
                        className="gs-alarm-chip"
                        aria-pressed={active}
                        onClick={() => toggleAlarm(minutes)}
                      >
                        {alarmChipLabel(minutes)}
                        {active && <span className="x">×</span>}
                      </button>
                    );
                  })}
                  {alarmCustomOpen ? (
                    <span className="gs-alarm-chip gs-alarm-custom">
                      <input
                        type="number"
                        min={0}
                        autoFocus
                        placeholder="min"
                        value={alarmCustomVal}
                        onChange={(event) => setAlarmCustomVal(event.target.value)}
                        onBlur={addCustomAlarm}
                        onKeyDown={(event) => event.key === 'Enter' && addCustomAlarm()}
                      />
                    </span>
                  ) : (
                    <button
                      className="gs-alarm-chip gs-alarm-add"
                      aria-label="Add custom alarm"
                      onClick={() => setAlarmCustomOpen(true)}
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {!isNew && onDelete && (
            <button className="gs-delete" onClick={onDelete}>
              Delete task
            </button>
          )}
        </div>

        {notificationMenu && (
          <div className="gmenu-scrim" onClick={() => setNotificationMenu(null)}>
            <div className="gmenu" onClick={(event) => event.stopPropagation()}>
              {notificationMenu.target !== 'new' && (
                <button className="gmenu-item" onClick={() => applyNotification(null)}>
                  <span className="gmenu-check" />None
                </button>
              )}
              {NOTIFICATION_CHOICES.map((minutes) => (
                <button key={minutes} className="gmenu-item" onClick={() => applyNotification(minutes)}>
                  <span className="gmenu-check">{notificationMenu.target === minutes ? '✓' : ''}</span>
                  {notificationLabel(minutes)}
                </button>
              ))}
              {!customOpen ? (
                <button className="gmenu-item" onClick={() => setCustomOpen(true)}>
                  <span className="gmenu-check" />Custom...
                </button>
              ) : (
                <div className="gmenu-custom">
                  <input
                    type="number"
                    min={0}
                    autoFocus
                    placeholder="min"
                    value={customValue}
                    onChange={(event) => setCustomValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      const minutes = parseInt(customValue, 10);
                      if (Number.isFinite(minutes) && minutes >= 0) applyNotification(minutes);
                      setCustomValue('');
                    }}
                  />
                  <span>minutes before</span>
                  <button
                    className="gmenu-ok"
                    onClick={() => {
                      const minutes = parseInt(customValue, 10);
                      if (Number.isFinite(minutes) && minutes >= 0) applyNotification(minutes);
                      setCustomValue('');
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

export function draftTask(
  calendarId: string,
  defaultNotifications: number[],
  defaultAlarms: number[],
  at?: number,
): TaskItem {
  const due = new Date(at ?? Date.now() + MS_HOUR);
  if (at == null) due.setMinutes(0, 0, 0);
  return {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    calendarId,
    title: '',
    due: due.getTime(),
    hasTime: true,
    notifications: [...defaultNotifications],
    alarms: [...defaultAlarms],
  };
}
