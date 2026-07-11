import type { EventItem, Recurrence } from '../types';
import { MS_DAY } from './dates';
import { uid } from '../state/store';

/**
 * Minimal but practical ICS parser: VEVENT with DTSTART/DTEND (date or
 * date-time, UTC or floating/TZID-as-local), SUMMARY, DESCRIPTION, LOCATION,
 * RRULE (FREQ/INTERVAL/COUNT/UNTIL/BYDAY), EXDATE, VALARM triggers.
 */

interface RawProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfoldLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else if (line.length) {
      out.push(line);
    }
  }
  return out;
}

function parseProp(line: string): RawProp | null {
  const colon = findUnquoted(line, ':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

function findUnquoted(s: string, ch: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') inQuote = !inQuote;
    else if (s[i] === ch && !inQuote) return i;
  }
  return -1;
}

/** parse ICS date / date-time. TZID values are approximated as local time. */
function parseIcsDate(value: string, params: Record<string, string>): { t: number; allDay: boolean } | null {
  const isDate = params['VALUE'] === 'DATE' || /^\d{8}$/.test(value);
  if (isDate) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { t: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    return { t: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false };
  }
  return { t: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)).getTime(), allDay: false };
}

const DOW_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(value: string): Recurrence | undefined {
  const parts: Record<string, string> = {};
  for (const kv of value.split(';')) {
    const [k, v] = kv.split('=');
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const freq = parts['FREQ'] as Recurrence['freq'] | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return undefined;
  const rec: Recurrence = { freq, interval: parts['INTERVAL'] ? Math.max(1, +parts['INTERVAL']) : 1 };
  if (parts['COUNT']) rec.count = +parts['COUNT'];
  if (parts['UNTIL']) {
    const until = parseIcsDate(parts['UNTIL'], {});
    if (until) rec.until = until.t + (until.allDay ? MS_DAY - 1 : 0);
  }
  if (freq === 'WEEKLY' && parts['BYDAY']) {
    const days = parts['BYDAY']
      .split(',')
      .map((d) => DOW_MAP[d.slice(-2)])
      .filter((d) => d !== undefined);
    if (days.length) rec.byDay = days;
  }
  return rec;
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

export interface IcsParseResult {
  calendarName: string | null;
  events: Omit<EventItem, 'calendarId'>[];
}

export function parseIcs(text: string, defaultAlarms: number[]): IcsParseResult {
  const lines = unfoldLines(text);
  const events: Omit<EventItem, 'calendarId'>[] = [];
  let calendarName: string | null = null;

  let cur: Record<string, RawProp[]> | null = null;
  let inAlarm = false;
  let alarmTriggers: number[] = [];

  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) {
      cur = {};
      alarmTriggers = [];
      continue;
    }
    if (/^BEGIN:VALARM/i.test(line)) {
      inAlarm = true;
      continue;
    }
    if (/^END:VALARM/i.test(line)) {
      inAlarm = false;
      continue;
    }
    if (/^END:VEVENT/i.test(line)) {
      if (cur) {
        const ev = buildEvent(cur, alarmTriggers, defaultAlarms);
        if (ev) events.push(ev);
      }
      cur = null;
      continue;
    }
    const prop = parseProp(line);
    if (!prop) continue;
    if (!cur) {
      if (prop.name === 'X-WR-CALNAME') calendarName = unescapeText(prop.value);
      continue;
    }
    if (inAlarm) {
      if (prop.name === 'TRIGGER') {
        // e.g. -PT30M, -PT1H, -P1D
        const m = prop.value.match(/^-P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/i);
        if (m) {
          const mins = (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
          if (mins >= 0) alarmTriggers.push(mins);
        }
      }
      continue;
    }
    (cur[prop.name] ??= []).push(prop);
  }

  return { calendarName, events };
}

function buildEvent(
  props: Record<string, RawProp[]>,
  alarmTriggers: number[],
  defaultAlarms: number[],
): Omit<EventItem, 'calendarId'> | null {
  const get = (n: string) => props[n]?.[0];
  const dtstart = get('DTSTART');
  if (!dtstart) return null;
  const start = parseIcsDate(dtstart.value, dtstart.params);
  if (!start) return null;

  const dtend = get('DTEND');
  let end: number;
  if (dtend) {
    const e = parseIcsDate(dtend.value, dtend.params);
    end = e ? e.t : start.t + (start.allDay ? MS_DAY : 3_600_000);
  } else {
    const dur = get('DURATION');
    if (dur) {
      const m = dur.value.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/i);
      const ms = m ? (+(m[1] || 0)) * MS_DAY + (+(m[2] || 0)) * 3_600_000 + (+(m[3] || 0)) * 60_000 : 0;
      end = start.t + (ms || (start.allDay ? MS_DAY : 3_600_000));
    } else {
      end = start.t + (start.allDay ? MS_DAY : 3_600_000);
    }
  }

  const exceptions: number[] = [];
  for (const ex of props['EXDATE'] ?? []) {
    for (const v of ex.value.split(',')) {
      const d = parseIcsDate(v.trim(), ex.params);
      if (d) exceptions.push(d.t);
    }
  }

  const rrule = get('RRULE') ? parseRRule(get('RRULE')!.value) : undefined;
  const uniqueAlarms = [...new Set(alarmTriggers)].sort((a, b) => b - a);

  return {
    id: uid(),
    title: get('SUMMARY') ? unescapeText(get('SUMMARY')!.value) : '(untitled)',
    description: get('DESCRIPTION') ? unescapeText(get('DESCRIPTION')!.value) : undefined,
    location: get('LOCATION') ? unescapeText(get('LOCATION')!.value) : undefined,
    start: start.t,
    end,
    allDay: start.allDay,
    recurrence: rrule,
    exceptions: exceptions.length ? exceptions : undefined,
    alarms: uniqueAlarms.length ? uniqueAlarms : [...defaultAlarms],
  };
}
