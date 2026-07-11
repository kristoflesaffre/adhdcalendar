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
  /** minutes before due — the same ringing alarms as events (needs hasTime) */
  alarms: number[];
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
  /** default alarm offsets (minutes) applied to new events when enabled */
  defaultAlarms: number[];
  weekStartsOn: 0 | 1;
}

export interface AppState {
  calendars: CalendarInfo[];
  events: EventItem[];
  tasks: TaskItem[];
  settings: Settings;
}

export const EVENT_PALETTE: { name: string; value: string }[] = [
  { name: 'Verdigris', value: '#206657' },
  { name: 'Cobalt', value: '#3a5bc7' },
  { name: 'Plum', value: '#7d4a9e' },
  { name: 'Rust', value: '#b3502d' },
  { name: 'Ochre', value: '#9a7514' },
  { name: 'Slate', value: '#5b6472' },
  { name: 'Rose', value: '#b8447a' },
  { name: 'Moss', value: '#5f7f3a' },
];
