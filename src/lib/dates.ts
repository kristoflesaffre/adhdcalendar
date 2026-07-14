export const MS_MIN = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

export function startOfDay(t: number | Date): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(t: number | Date): Date {
  const d = startOfDay(t);
  d.setDate(d.getDate() + 1);
  return d;
}

export function addDays(t: number | Date, n: number): Date {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d;
}

export function addMonths(t: number | Date, n: number): Date {
  const d = new Date(t);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = daysInMonth(d.getFullYear(), d.getMonth());
  d.setDate(Math.min(day, last));
  return d;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function startOfWeek(t: number | Date, weekStartsOn: 0 | 1 = 1): Date {
  const d = startOfDay(t);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function startOfMonth(t: number | Date): Date {
  const d = startOfDay(t);
  d.setDate(1);
  return d;
}

export function isSameDay(a: number | Date, b: number | Date): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function isToday(t: number | Date): boolean {
  return isSameDay(t, new Date());
}

/** minutes since local midnight */
export function minutesOfDay(t: number | Date): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

export function setMinutesOfDay(day: number | Date, minutes: number): Date {
  const d = startOfDay(day);
  d.setMinutes(minutes);
  return d;
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fullDayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const weekdayShortFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

export const fmtTime = (t: number | Date) => timeFmt.format(t);
export const fmtDay = (t: number | Date) => dayFmt.format(t);
export const fmtFullDay = (t: number | Date) => fullDayFmt.format(t);
export const fmtMonth = (t: number | Date) => monthFmt.format(t);
export const fmtWeekdayShort = (t: number | Date) => weekdayShortFmt.format(t);

export function fmtTimeRange(start: number, end: number): string {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

/** "2026-07-10T09:30" for <input type="datetime-local"> */
export function toLocalInputValue(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toLocalDateValue(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromLocalInputValue(v: string): number {
  return new Date(v).getTime();
}

/** Human label for an alarm offset in minutes */
export function fmtOffset(minutes: number): string {
  if (minutes === 0) return 'At start';
  if (minutes % 10080 === 0) {
    const w = minutes / 10080;
    return `${w} week${w > 1 ? 's' : ''}`;
  }
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} day${d > 1 ? 's' : ''}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h > 1 ? 's' : ''}`;
  }
  return `${minutes} min`;
}

/** Relative "starts in…" label */
export function fmtStartsIn(occStart: number, now: number): string {
  const diff = occStart - now;
  if (Math.abs(diff) < MS_MIN) return 'Starting now';
  if (diff < 0) {
    const m = Math.round(-diff / MS_MIN);
    if (m < 60) return `Started ${m} min ago`;
    return `Started at ${fmtTime(occStart)}`;
  }
  const m = Math.round(diff / MS_MIN);
  if (m < 60) return `Starts in ${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `Starts in ${h}h${rem ? ` ${rem}m` : ''}`;
}
