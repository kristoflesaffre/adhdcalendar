/**
 * Import a Google Calendar (or any calendar) by its private ICS feed URL —
 * the "Secret address in iCal format" every Google calendar has. No OAuth,
 * no cloud project: paste one link and you're connected.
 */

export function normalizeIcsUrl(raw: string): string {
  let url = raw.trim();
  if (url.startsWith('webcal://')) url = 'https://' + url.slice('webcal://'.length);
  return url;
}

function isGoogleFeed(url: URL): boolean {
  return url.hostname === 'calendar.google.com';
}

/**
 * A Google secret address embeds the calendar id:
 * https://calendar.google.com/calendar/ical/<calendar-id>/private-…/basic.ics
 * Extracting it lets us recognise that a read-only link and a two-way
 * connection point at the same calendar (and avoid duplicates).
 */
export function googleIdFromIcsUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(normalizeIcsUrl(rawUrl));
    if (!isGoogleFeed(url)) return null;
    const m = url.pathname.match(/^\/calendar\/ical\/([^/]+)\//);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export async function fetchIcsText(rawUrl: string): Promise<string> {
  const urlStr = normalizeIcsUrl(rawUrl);
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error('That doesn’t look like a link. Paste the full address, starting with https://');
  }

  // Inside the iOS app, native HTTP has no CORS restrictions
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    try {
      const { CapacitorHttp } = await import('@capacitor/core');
      const res = await CapacitorHttp.get({ url: urlStr, responseType: 'text' });
      if (res.status >= 200 && res.status < 300) return validate(String(res.data));
    } catch {
      // fall through to fetch attempts
    }
  }

  // 1) direct fetch (works for CORS-friendly hosts)
  try {
    const res = await fetch(urlStr);
    if (res.ok) return validate(await res.text());
  } catch {
    // CORS or network — try the dev proxy below
  }

  // 2) Google feeds via the dev-server proxy
  if (isGoogleFeed(url)) {
    try {
      const res = await fetch('/gcal-proxy' + url.pathname + url.search);
      if (res.ok) return validate(await res.text());
      if (res.status === 404)
        throw new Error(
          'Google didn’t recognise that address. Copy the “Secret address in iCal format” again — it may have been reset.',
        );
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Google')) throw e;
    }
  }

  throw new Error('Couldn’t reach that calendar. Check the link and your connection, then try again.');
}

function validate(text: string): string {
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new Error('That link doesn’t point to a calendar feed. Make sure you copied the iCal address.');
  }
  return text;
}
