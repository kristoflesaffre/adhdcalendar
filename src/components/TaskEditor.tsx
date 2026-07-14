import { useEffect, useRef, useState } from 'react';
import type { Recurrence, TaskItem } from '../types';
import { MS_HOUR, startOfDay, toLocalDateValue } from '../lib/dates';
import { useStore } from '../state/store';
import { ensureAudioUnlocked } from '../alarm/sound';
import {
  CalIcon,
  Camera,
  ChevronDown,
  Clock,
  Close,
  Notes,
  ReminderIcon,
  Repeat,
  RingingBell,
} from './icons';

interface Props {
  draft: TaskItem;
  isNew: boolean;
  onSave: (task: TaskItem) => void;
  onDelete?: () => void;
  onClose: () => void;
  onSwitchToEvent?: () => void;
}

const NOTIFICATION_CHOICES = [0, 10, 30, 60, 1440, 10080];
const ALARM_CHOICES = [0, 5, 10, 15];

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

function notificationLabel(minutes: number): string {
  if (minutes === 0) return 'At time of task';
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes > 10080 ? 's' : ''} before`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes > 1440 ? 's' : ''} before`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes > 60 ? 's' : ''} before`;
  return `${minutes} minutes before`;
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

  const setHasTime = (hasTime: boolean) => {
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

  const valid = task.title.trim().length > 0 && !!task.calendarId;
  const save = () => {
    if (!valid) return;
    ensureAudioUnlocked();
    onSave({ ...task, title: task.title.trim() });
  };

  return (
    <div className="modal-backdrop task-modal-backdrop">
      <div className="modal task-modal" role="dialog" aria-modal="true" aria-label={isNew ? 'New task' : 'Edit task'}>
        <div className="task-sheet-head">
          <button className="gsheet-cancel" onClick={onClose}>Cancel</button>
          <strong>{isNew ? 'New task' : 'Edit task'}</strong>
          <button className="gsheet-save" onClick={save} disabled={!valid}>Save</button>
        </div>

        <div className="task-sheet-scroll">
          <div className="task-title-wrap">
            <input
              className="gsheet-title"
              placeholder="Add title"
              value={task.title}
              autoFocus={isNew}
              onChange={(event) => patch({ title: event.target.value })}
              onKeyDown={(event) => event.key === 'Enter' && save()}
            />
            {isNew && onSwitchToEvent && (
              <div className="kind-chips">
                <button className="cal-chip" onClick={onSwitchToEvent}>Event</button>
                <button className="cal-chip" aria-pressed="true">Task</button>
              </div>
            )}
          </div>

          <div className="gdiv" />

          <div className="grow-item task-details-row">
            <span className="gicon"><Notes size={22} /></span>
            <textarea
              className="ginput"
              placeholder="Add details"
              rows={2}
              value={task.description ?? ''}
              onChange={(event) => patch({ description: event.target.value || undefined })}
            />
          </div>

          <div className="gdiv" />

          <div className="grow-item">
            <span className="gicon"><Clock size={22} /></span>
            <span className="glabel">All day</span>
            <input
              type="checkbox"
              className="ios-switch"
              checked={!task.hasTime}
              onChange={(event) => setHasTime(!event.target.checked)}
              aria-label="All day"
            />
          </div>

          <div className="grow-item task-date-row">
            <span className="gicon" />
            <input
              type="date"
              className="task-date-input"
              aria-label="Due date"
              value={toLocalDateValue(task.due)}
              onChange={(event) => {
                const [year, month, day] = event.target.value.split('-').map(Number);
                if (!year) return;
                const current = new Date(task.due);
                patch({ due: new Date(year, month - 1, day, current.getHours(), current.getMinutes()).getTime() });
              }}
            />
            {task.hasTime && (
              <input
                type="time"
                className="task-time-input"
                aria-label="Due time"
                value={timeValue(task.due)}
                onChange={(event) => {
                  const [hour, minute] = event.target.value.split(':').map(Number);
                  if (!Number.isFinite(hour)) return;
                  const due = startOfDay(task.due);
                  due.setHours(hour, minute);
                  patch({ due: due.getTime() });
                }}
              />
            )}
          </div>

          <div className="grow-item">
            <span className="gicon"><Repeat size={22} /></span>
            <select
              className="gselect"
              value={recToChoice(task.recurrence)}
              onChange={(event) => patch({
                recurrence: choiceToRec(event.target.value as RecChoice, task.due),
                exceptions: undefined,
              })}
            >
              <option value="none">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKDAYS">Every weekday (Mon-Fri)</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </div>

          <div className="gdiv" />

          <div className="grow-item">
            <span className="gicon"><CalIcon size={22} /></span>
            <div className="cal-chip-row">
              {writableCalendars.map((calendar) => (
                <button
                  key={calendar.id}
                  className="cal-chip"
                  aria-pressed={task.calendarId === calendar.id}
                  style={{ ['--chip-color' as any]: calendar.color }}
                  onClick={() => patch({ calendarId: calendar.id })}
                >
                  <span className="dot" style={{ background: calendar.color }} />
                  {calendar.name}
                </button>
              ))}
            </div>
          </div>

          {task.hasTime && (
            <>
              <div className="gdiv" />
              {sortedNotifications.map((minutes, index) => (
                <button
                  key={minutes}
                  className="grow-item galarm"
                  onClick={() => setNotificationMenu({ target: minutes })}
                >
                  <span className="gicon">{index === 0 ? <ReminderIcon size={23} /> : null}</span>
                  <span className="glabel">{notificationLabel(minutes)}</span>
                  <span className="gunfold"><ChevronDown size={14} /></span>
                </button>
              ))}
              <button className="grow-item galarm" onClick={() => setNotificationMenu({ target: 'new' })}>
                <span className="gicon">{sortedNotifications.length === 0 ? <ReminderIcon size={23} /> : null}</span>
                <span className="glabel gmuted">Add notification</span>
                <span className="gunfold"><ChevronDown size={14} /></span>
              </button>

              <div className="grow-item galarm-choice editor-alarm-swimlane">
                <span className="gicon"><RingingBell size={22} /></span>
                <div className="galarm-choice-body">
                  <span className="glabel">Alarm</span>
                  <div className="alarm-chips" role="group" aria-label="Alarm time">
                    {ALARM_CHOICES.map((minutes) => (
                      <button
                        key={minutes}
                        className="chip-btn"
                        aria-pressed={task.alarms.includes(minutes)}
                        onClick={() => toggleAlarm(minutes)}
                      >
                        {minutes} min
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="gdiv" />

          <div className="grow-item task-screenshot-row">
            <span className="gicon"><Camera size={22} /></span>
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

          {!isNew && onDelete && (
            <>
              <div className="gdiv" />
              <button className="grow-item gdelete" onClick={onDelete}>
                <span className="gicon" />
                <span className="glabel">Delete task</span>
              </button>
            </>
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
