import type { CalendarInfo, EventItem, Recurrence } from '../types';
import { MS_DAY } from './dates';
import { uid } from '../state/store';

/**
 * Google Calendar two-way sync via Google Identity Services (token flow) +
 * Calendar REST API. The user supplies their own OAuth Client ID once
 * (create at console.cloud.google.com, type "Web application", with this
 * app's origin as an authorized JavaScript origin).
 *
 * Events land straight from Google in this browser and back; no middleman.
 */

declare global {
  interface Window {
    google?: any;
  }
}

const SCOPES =
  'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
const TOKEN_KEY = 'carillon.gtoken.v1';

let gisPromise: Promise<void> | null = null;

export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in. Check your connection.'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

interface CachedToken {
  token: string;
  exp: number;
}

function loadCachedToken(): CachedToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as CachedToken;
    return t.exp > Date.now() + 30_000 ? t : null;
  } catch {
    return null;
  }
}

let lastAuthError: string | null = null;

/** Human-readable reason the last sign-in attempt failed (null = none) */
export function getLastAuthError(): string | null {
  return lastAuthError;
}

/**
 * Get an access token. After the first consent this is usually silent
 * (no popup). Returns null when sign-in is needed but couldn't happen —
 * check getLastAuthError() for a human-readable reason.
 */
export async function getAccessToken(clientId: string): Promise<string | null> {
  const cached = loadCachedToken();
  if (cached) return cached.token;
  lastAuthError = null;
  try {
    await loadGis();
  } catch {
    lastAuthError = 'Could not load Google sign-in — check your internet connection.';
    return null;
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (resp: any) => {
          if (resp.access_token) {
            const cachedToken: CachedToken = {
              token: resp.access_token,
              exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60_000,
            };
            try {
              sessionStorage.setItem(TOKEN_KEY, JSON.stringify(cachedToken));
            } catch {
              // session storage unavailable
            }
            done(resp.access_token);
          } else {
            lastAuthError =
              resp.error === 'access_denied'
                ? 'Google refused access. Usually this means your Google account isn’t on the Test users list (setup step 4) — or you clicked Cancel.'
                : resp.error
                  ? `Google reported: ${resp.error_description || resp.error}`
                  : 'Google sign-in didn’t complete.';
            done(null);
          }
        },
        error_callback: (err: any) => {
          lastAuthError =
            err?.type === 'popup_failed_to_open'
              ? 'The sign-in popup was blocked. Allow popups for this site and try again.'
              : err?.type === 'popup_closed'
                ? 'The Google window was closed before sign-in finished. If it showed “Access blocked”, see the fixes under “Sign-in fails?” below.'
                : 'Google sign-in failed. See the fixes under “Sign-in fails?” below.';
          done(null);
        },
      });
      client.requestAccessToken({ prompt: '' });
      // popup silently blocked → never calls back; give up after a while
      setTimeout(() => {
        if (!settled) lastAuthError = 'The sign-in window never responded — allow popups and try again.';
        done(null);
      }, 90_000);
    } catch {
      lastAuthError = 'Google sign-in failed to start. Is the Client ID complete?';
      done(null);
    }
  });
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
  readOnly?: boolean;
}

async function gFetch(token: string, url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    throw new AuthError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = new Error(body?.error?.message || `Google API error (${res.status})`);
    (err as any).status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

export class AuthError extends Error {
  constructor() {
    super('Google sign-in expired.');
  }
}

export async function listGoogleCalendars(token: string): Promise<GoogleCalendarListEntry[]> {
  const data = await gFetch(
    token,
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250',
  );
  return (data.items ?? []).map((it: any) => ({
    id: it.id,
    summary: it.summaryOverride || it.summary,
    backgroundColor: it.backgroundColor,
    primary: !!it.primary,
    readOnly: it.accessRole === 'reader' || it.accessRole === 'freeBusyReader',
  }));
}

const eventsUrl = (gcalId: string, tail = '') =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(gcalId)}/events${tail}`;

/**
 * Pull events from one Google calendar as expanded single events
 * (recurring series arrive pre-expanded), 3 months back to 18 months ahead.
 */
export async function fetchGoogleEvents(
  token: string,
  googleCalendarId: string,
  localCalendarId: string,
  defaultAlarms: number[],
): Promise<EventItem[]> {
  const timeMin = new Date(Date.now() - 92 * MS_DAY).toISOString();
  const timeMax = new Date(Date.now() + 548 * MS_DAY).toISOString();
  const events: EventItem[] = [];
  let pageToken = '';

  do {
    const url = eventsUrl(
      googleCalendarId,
      `?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(timeMin)}` +
        `&timeMax=${encodeURIComponent(timeMax)}${pageToken ? `&pageToken=${pageToken}` : ''}`,
    );
    const data = await gFetch(token, url);
    for (const item of data.items ?? []) {
      if (item.status === 'cancelled') continue;
      const ev = mapGoogleEvent(item, localCalendarId, defaultAlarms);
      if (ev) events.push(ev);
    }
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);

  return events;
}

function mapGoogleEvent(item: any, calendarId: string, defaultAlarms: number[]): EventItem | null {
  const startRaw = item.start ?? {};
  const endRaw = item.end ?? {};
  let start: number;
  let end: number;
  let allDay = false;

  if (startRaw.dateTime) {
    start = new Date(startRaw.dateTime).getTime();
    end = new Date(endRaw.dateTime ?? startRaw.dateTime).getTime();
  } else if (startRaw.date) {
    allDay = true;
    start = parseLocalDate(startRaw.date);
    end = endRaw.date ? parseLocalDate(endRaw.date) : start + MS_DAY;
  } else {
    return null;
  }

  // carry over Google reminders as real alarms
  let alarms: number[] = [];
  if (item.reminders?.overrides?.length) {
    alarms = item.reminders.overrides
      .map((o: any) => Number(o.minutes))
      .filter((m: number) => Number.isFinite(m) && m >= 0);
  } else if (item.reminders?.useDefault) {
    alarms = [...defaultAlarms];
  }
  alarms = [...new Set(alarms)].sort((a, b) => b - a);

  return {
    id: uid(),
    calendarId,
    title: item.summary || '(untitled)',
    description: item.description || undefined,
    location: item.location || undefined,
    start,
    end,
    allDay,
    alarms,
    // singleEvents=true expands recurring series; instances share the series
    // via recurringEventId — keep the instance id so edits patch precisely
    googleEventId: item.id,
  };
}

function parseLocalDate(v: string): number {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function makeGoogleCalendarInfo(
  entry: GoogleCalendarListEntry,
  existing?: CalendarInfo,
): CalendarInfo {
  return {
    id: existing?.id ?? `gcal-${uid()}`,
    name: entry.summary,
    color: existing?.color ?? entry.backgroundColor ?? '#3a5bc7',
    visible: existing?.visible ?? true,
    source: 'google',
    googleId: entry.id,
    readOnly: !!entry.readOnly,
    syncedAt: Date.now(),
  };
}

/* ---------------- write API (two-way sync) ---------------- */

const pad = (n: number) => String(n).padStart(2, '0');

function toRfc3339Local(t: number): string {
  const d = new Date(t);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function toDateStr(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toUtcBasic(t: number): string {
  const d = new Date(t);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function toRRule(r: Recurrence): string {
  let rule = `RRULE:FREQ=${r.freq}`;
  if (r.interval > 1) rule += `;INTERVAL=${r.interval}`;
  if (r.freq === 'WEEKLY' && r.byDay?.length) rule += `;BYDAY=${r.byDay.map((d) => DOW[d]).join(',')}`;
  if (r.count) rule += `;COUNT=${r.count}`;
  else if (r.until) rule += `;UNTIL=${toUtcBasic(r.until)}`;
  return rule;
}

/** Local event → Google event resource (title, times, recurrence, alarms) */
export function toGoogleResource(ev: EventItem): any {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const resource: any = {
    summary: ev.title || '(untitled)',
    description: ev.description ?? '',
    location: ev.location ?? '',
    start: ev.allDay ? { date: toDateStr(ev.start) } : { dateTime: toRfc3339Local(ev.start), timeZone: tz },
    end: ev.allDay ? { date: toDateStr(ev.end) } : { dateTime: toRfc3339Local(ev.end), timeZone: tz },
    reminders: {
      useDefault: false,
      overrides: [...ev.alarms]
        .sort((a, b) => a - b)
        .slice(0, 5)
        .map((m) => ({ method: 'popup', minutes: m })),
    },
  };
  if (ev.recurrence) {
    const lines = [toRRule(ev.recurrence)];
    if (ev.exceptions?.length) {
      const stamps = ev.exceptions
        .map((t) => (ev.allDay ? toDateStr(t).replace(/-/g, '') : toUtcBasic(t)))
        .join(',');
      lines.push(ev.allDay ? `EXDATE;VALUE=DATE:${stamps}` : `EXDATE:${stamps}`);
    }
    resource.recurrence = lines;
  } else {
    resource.recurrence = [];
  }
  return resource;
}

export async function gInsertEvent(token: string, gcalId: string, resource: any): Promise<string> {
  const data = await gFetch(token, eventsUrl(gcalId), {
    method: 'POST',
    body: JSON.stringify(resource),
  });
  return data.id as string;
}

export async function gPatchEvent(
  token: string,
  gcalId: string,
  gEventId: string,
  resource: any,
): Promise<void> {
  await gFetch(token, eventsUrl(gcalId, `/${encodeURIComponent(gEventId)}`), {
    method: 'PATCH',
    body: JSON.stringify(resource),
  });
}

export async function gDeleteEvent(token: string, gcalId: string, gEventId: string): Promise<void> {
  try {
    await gFetch(token, eventsUrl(gcalId, `/${encodeURIComponent(gEventId)}`), { method: 'DELETE' });
  } catch (e) {
    // already gone on Google's side — that's the outcome we wanted
    if ((e as any)?.status === 404 || (e as any)?.status === 410) return;
    throw e;
  }
}
