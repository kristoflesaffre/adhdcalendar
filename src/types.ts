import type { AlarmSoundId } from './alarm/sounds';

export type ViewMode = 'schedule' | 'day' | '3day' | 'week' | 'month';

export type CalendarSource = 'local' | 'google' | 'ics';

export interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  source: CalendarSource;
  /** Google calendar id, for OAuth re-sync */
  googleId?: string;
  /** private ICS feed URL — auto-synced on every app start */
  icsUrl?: string;
  /** last successful sync (ms) */
  syncedAt?: number;
  readOnly?: boolean;
}

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Recurrence {
  freq: Freq;
  interval: number;
  /** 0 = Sunday … 6 = Saturday (only for WEEKLY) */
  byDay?: number[];
  /** ms timestamp, inclusive */
  until?: number;
  count?: number;
}

export interface EventItem {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  /** ms timestamp */
  start: number;
  /** ms timestamp (exclusive end) */
  end: number;
  allDay: boolean;
  recurrence?: Recurrence;
  /** occurrence start times (ms) removed from the series */
  exceptions?: number[];
  /** minutes before start; standard push notifications with a short sound */
  notifications: number[];
  /** minutes before start; the signature feature — real alarms */
  alarms: number[];
  /** per-event color override */
  color?: string;
  /** id of this event on Google Calendar (two-way synced calendars) */
  googleEventId?: string;
}

/** A concrete instance of an event (recurring events expand to many) */
export interface Occurrence {
  event: EventItem;
  start: number;
  end: number;
  /** stable key: eventId@occStart */
  key: string;
}

/** A Todoist-style task: check-offable, optionally timed, with real alarms */
export interface TaskItem {
  id: string;
  /** tasks live in the same calendars as events — calendar ≈ project */
  calendarId: string;
  title: string;
  description?: string;
  /** due moment: start-of-day (day task) or an exact time */
  due: number;
  hasTime: boolean;
  recurrence?: Recurrence;
  /** occurrence due-times removed from a recurring series */
  exceptions?: number[];
  /** occurrence due-times that are checked off */
  completedOn?: number[];
  /** minutes before due; standard push notifications with a short sound */
  notifications: number[];
  /** minutes before due — the same ringing alarms as events (needs hasTime) */
  alarms: number[];
  /** compressed local screenshot attached to the task */
  screenshot?: string;
}

export interface TaskOccurrence {
  task: TaskItem;
  due: number;
  /** stable key: taskId@due */
  key: string;
  completed: boolean;
}

export interface RingingAlarm {
  /** eventId@occStart@minutesBefore */
  key: string;
  eventId: string;
  title: string;
  calendarName: string;
  color: string;
  occStart: number;
  minutesBefore: number;
  location?: string;
  firedAt: number;
  snoozed?: boolean;
}

export interface Snooze {
  key: string;
  alarm: Omit<RingingAlarm, 'firedAt' | 'snoozed'>;
  triggerAt: number;
}

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePref;
  googleClientId: string;
  alarmSound: AlarmSoundId;
  /** default notification offsets (minutes) applied to new events */
  defaultNotifications: number[];
  /** default alarm offsets (minutes) applied to new events when enabled */
  defaultAlarms: number[];
  weekStartsOn: 0 | 1;
}

/** An iOS-style clock alarm: rings at a wall-clock time, optionally repeating */
export interface AlarmClockItem {
  id: string;
  hour: number;
  minute: number;
  label: string;
  /** 0 = Sunday … 6 = Saturday; empty = one-time (next occurrence) */
  repeatDays: number[];
  enabled: boolean;
  /** first occurrence moment (ms) — the recurrence anchor */
  anchor: number;
}

/** A running countdown timer (multiple can run at once) */
export interface ActiveTimer {
  id: string;
  label: string;
  totalMs: number;
  startedAt: number;
  endAt: number;
  /** remaining ms frozen while paused (endAt is recomputed on resume) */
  pausedRemaining?: number;
  /** the cube-face hue this timer was started from (color = duration) */
  hue?: number;
}

export interface AppState {
  calendars: CalendarInfo[];
  events: EventItem[];
  tasks: TaskItem[];
  alarmClocks: AlarmClockItem[];
  timers: ActiveTimer[];
  settings: Settings;
}

export const EVENT_PALETTE: { name: string; value: string }[] = [
  { name: 'Mint', value: '#2f8f6f' },
  { name: 'Teal', value: '#167c83' },
  { name: 'Azure', value: '#2f64c8' },
  { name: 'Indigo', value: '#5d55b8' },
  { name: 'Violet', value: '#7a4aa2' },
  { name: 'Coral', value: '#b85a3a' },
  { name: 'Amber', value: '#9f7a16' },
  { name: 'Moss', value: '#5d7f36' },
];
