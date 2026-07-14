import type { AlarmClockItem, CalendarInfo, EventItem } from '../types';
import { MS_DAY, MS_MIN, startOfDay } from './dates';

/**
 * Clock alarms are projected into the calendar as synthetic events in a
 * virtual, read-only "Alarms" calendar. That single trick makes them show
 * up in every view (schedule, day, week, month, today) AND ring through
 * the existing real-alarm engine — native background audio included —
 * without any of those layers knowing alarms exist.
 */

export const ALARM_CAL_ID = 'cal-alarm-clocks';
export const ALARM_EVENT_PREFIX = 'alarmclock:';

export const ALARM_CALENDAR: CalendarInfo = {
  id: ALARM_CAL_ID,
  name: 'Alarms',
  color: '#e07b39',
  visible: true,
  source: 'local',
  readOnly: true,
};

/** the moment this alarm's time next occurs, strictly after `from` */
export function nextAlarmMoment(hour: number, minute: number, from: number): number {
  const d = startOfDay(new Date(from));
  d.setHours(hour, minute, 0, 0);
  let t = d.getTime();
  if (t <= from) t += MS_DAY;
  return t;
}

/** recurrence anchor for a (re)saved alarm: today at hh:mm */
export function alarmAnchor(hour: number, minute: number, repeatDays: number[]): number {
  if (!repeatDays.length) return nextAlarmMoment(hour, minute, Date.now());
  const d = startOfDay(new Date());
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export function alarmToEvent(alarm: AlarmClockItem): EventItem {
  return {
    id: `${ALARM_EVENT_PREFIX}${alarm.id}`,
    calendarId: ALARM_CAL_ID,
    title: `⏰ ${alarm.label || 'Alarm'}`,
    start: alarm.anchor,
    end: alarm.anchor + 30 * MS_MIN,
    allDay: false,
    recurrence: alarm.repeatDays.length
      ? { freq: 'WEEKLY', interval: 1, byDay: [...alarm.repeatDays].sort() }
      : undefined,
    notifications: [],
    alarms: [0],
  };
}

/** enabled alarms → synthetic calendar events */
export function alarmClockEvents(alarms: AlarmClockItem[]): EventItem[] {
  return alarms.filter((a) => a.enabled).map(alarmToEvent);
}

export function alarmClockIdFromEvent(eventId: string): string | null {
  return eventId.startsWith(ALARM_EVENT_PREFIX) ? eventId.slice(ALARM_EVENT_PREFIX.length) : null;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [1, 2, 3, 4, 5];

export function describeRepeatDays(repeatDays: number[]): string {
  if (!repeatDays.length) return 'Once';
  if (repeatDays.length === 7) return 'Every day';
  const sorted = [...repeatDays].sort();
  if (sorted.length === 5 && WEEKDAYS.every((d, i) => sorted[i] === d)) return 'Every weekday';
  if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) return 'Weekends';
  return sorted.map((d) => DOW[d]).join(' ');
}

export function fmtAlarmTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** next ring moment of an enabled alarm, or null */
export function alarmNextRing(alarm: AlarmClockItem, from: number): number | null {
  if (!alarm.enabled) return null;
  if (!alarm.repeatDays.length) return alarm.anchor > from ? alarm.anchor : null;
  for (let i = 0; i < 8; i++) {
    const day = startOfDay(new Date(from + i * MS_DAY));
    if (!alarm.repeatDays.includes(day.getDay())) continue;
    day.setHours(alarm.hour, alarm.minute, 0, 0);
    if (day.getTime() > from) return day.getTime();
  }
  return null;
}

/**
 * Color = time of day, one hue per hour: a full spectrum sweep that starts
 * at sunrise orange for 07:00 and travels the wheel through the day —
 * evening blues, night purples, dawn reds — back to 06:00.
 */
export function hourHue(hour: number): number {
  const order = (((hour - 7) % 24) + 24) % 24;
  return Math.round((25 + order * 15) % 360);
}

/** card gradient stops for an alarm hour; yellows dip darker so white text keeps contrast */
export function hourGradient(hour: number): { a: string; b: string } {
  const h = hourHue(hour);
  const light = h >= 35 && h <= 105 ? 38 : 47;
  // the deep stop shifts toward red, not yellow — yellow-shifted deeps go muddy olive
  return {
    a: `hsl(${h} 68% ${light}%)`,
    b: `hsl(${(h - 18 + 360) % 360} 64% ${Math.max(24, light - 13)}%)`,
  };
}

/** "9h 34m" — countdown copy for the alarms page header */
export function fmtUntil(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / MS_MIN));
  const d = Math.floor(totalMin / (60 * 24));
  const h = Math.floor((totalMin % (60 * 24)) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
