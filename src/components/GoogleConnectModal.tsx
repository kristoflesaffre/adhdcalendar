import { useEffect, useState } from 'react';
import type { CalendarInfo } from '../types';
import { EVENT_PALETTE } from '../types';
import { useStore, uid } from '../state/store';
import { parseIcs } from '../lib/ics';
import { fetchIcsText, googleIdFromIcsUrl, normalizeIcsUrl } from '../lib/icsUrl';
import type { GoogleCalendarListEntry } from '../lib/google';
import {
  fetchGoogleEvents,
  getAccessToken,
  getLastAuthError,
  listGoogleCalendars,
  makeGoogleCalendarInfo,
} from '../lib/google';
import { flushQueue } from '../lib/googleSync';
import { GoogleSetupWizard, SignInTroubleshooting } from './GoogleSetupWizard';
import { Close, GoogleG } from './icons';

interface Props {
  onClose: () => void;
}

const GOOGLE_SETTINGS_URL = 'https://calendar.google.com/calendar/u/0/r/settings';

export function GoogleConnectModal({ onClose }: Props) {
  const { state, dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [syncingId, setSyncingId] = useState('');

  // two-way (OAuth)
  const [clientId, setClientId] = useState(state.settings.googleClientId);
  const [gcals, setGcals] = useState<GoogleCalendarListEntry[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [showWizard, setShowWizard] = useState(!state.settings.googleClientId);

  // read-only (secret address)
  const [url, setUrl] = useState('');

  const connected = state.calendars.filter((c) => c.icsUrl || c.googleId);

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

  const onSynced = (localEventId: string, googleEventId: string) =>
    dispatch({ type: 'event/patch', id: localEventId, patch: { googleEventId } });

  /* ---- two-way: sign in, list calendars ---- */
  const signIn = async () => {
    const id = clientId.trim();
    if (!id) {
      setError('Finish step 5 first, then paste the Client ID in the box above the Sign in button.');
      return;
    }
    if (!/\.apps\.googleusercontent\.com$/.test(id)) {
      setError('That doesn’t look like a Client ID — it should end in .apps.googleusercontent.com (step 5).');
      return;
    }
    setBusy(true);
    setError('');
    setOkMsg('');
    dispatch({ type: 'settings/update', patch: { googleClientId: id } });
    try {
      const token = await getAccessToken(id);
      if (!token)
        throw new Error(getLastAuthError() ?? 'Google sign-in didn’t complete. Allow the popup and try again.');
      const cals = await listGoogleCalendars(token);
      setGcals(cals);
      const pre = new Set<string>();
      for (const c of cals) {
        if (c.primary || state.calendars.some((lc) => lc.googleId === c.id && !lc.icsUrl)) pre.add(c.id);
      }
      setChosen(pre);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect to Google.');
    } finally {
      setBusy(false);
    }
  };

  const importTwoWay = async () => {
    const id = clientId.trim();
    if (!gcals || !id) return;
    setBusy(true);
    setError('');
    try {
      const token = await getAccessToken(id);
      if (!token) throw new Error(getLastAuthError() ?? 'Google sign-in expired — sign in again.');
      await flushQueue(id, onSynced); // push local changes before pulling
      let total = 0;
      for (const entry of gcals.filter((c) => chosen.has(c.id))) {
        // a read-only link to this same calendar becomes redundant — remove it
        for (const twin of state.calendars.filter((lc) => googleIdFromIcsUrl(lc.icsUrl) === entry.id)) {
          dispatch({ type: 'calendar/delete', id: twin.id });
        }
        const existing = state.calendars.find((lc) => lc.googleId === entry.id && !lc.icsUrl);
        const calInfo = makeGoogleCalendarInfo(entry, existing);
        const events = await fetchGoogleEvents(token, entry.id, calInfo.id, state.settings.defaultAlarms);
        dispatch({ type: 'calendar/importEvents', calendar: calInfo, events });
        total += events.length;
      }
      setOkMsg(
        `Two-way sync is on for ${chosen.size} calendar${chosen.size === 1 ? '' : 's'} (${total} events). New events you make here appear in Google too.`,
      );
      setGcals(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  /* ---- read-only: secret address ---- */
  const connectReadOnly = async () => {
    const cleaned = normalizeIcsUrl(url);
    if (!cleaned) {
      setError('Paste the calendar address first.');
      return;
    }
    if (connected.some((c) => c.icsUrl === cleaned)) {
      setError('That calendar is already connected.');
      return;
    }
    const gId = googleIdFromIcsUrl(cleaned);
    if (gId && connected.some((c) => c.googleId === gId && !c.icsUrl)) {
      setError('That calendar is already connected with two-way sync — a read-only link on top would show every event twice.');
      return;
    }
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const text = await fetchIcsText(cleaned);
      const parsed = parseIcs(text, state.settings.defaultAlarms);
      const usedColors = new Set(state.calendars.map((c) => c.color));
      const calendar: CalendarInfo = {
        id: `gcal-${uid()}`,
        name: parsed.calendarName || 'Google Calendar',
        color:
          EVENT_PALETTE.find((p) => !usedColors.has(p.value))?.value ??
          EVENT_PALETTE[state.calendars.length % EVENT_PALETTE.length].value,
        visible: true,
        source: 'google',
        icsUrl: cleaned,
        syncedAt: Date.now(),
        readOnly: true,
      };
      dispatch({
        type: 'calendar/importEvents',
        calendar,
        events: parsed.events.map((e) => ({ ...e, calendarId: calendar.id })),
      });
      setOkMsg(`Connected “${calendar.name}” — ${parsed.events.length} events, read-only.`);
      setUrl('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async (cal: CalendarInfo) => {
    setSyncingId(cal.id);
    setError('');
    try {
      if (cal.icsUrl) {
        const text = await fetchIcsText(cal.icsUrl);
        const parsed = parseIcs(text, state.settings.defaultAlarms);
        dispatch({
          type: 'calendar/importEvents',
          calendar: { ...cal, syncedAt: Date.now() },
          events: parsed.events.map((e) => ({ ...e, calendarId: cal.id })),
        });
      } else if (cal.googleId) {
        const id = state.settings.googleClientId;
        const token = await getAccessToken(id);
        if (!token) throw new Error(getLastAuthError() ?? 'Google sign-in didn’t complete. Try again.');
        await flushQueue(id, onSynced);
        const events = await fetchGoogleEvents(token, cal.googleId, cal.id, state.settings.defaultAlarms);
        dispatch({ type: 'calendar/importEvents', calendar: { ...cal, syncedAt: Date.now() }, events });
      }
      setOkMsg(`“${cal.name}” is up to date.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncingId('');
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Connect Google Calendar">
        <div className="modal-head">
          <h2 className="modal-title">
            <GoogleG size={15} /> Connect Google Calendar
          </h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Close size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* ------- option 1: two-way ------- */}
          <section className="connect-card">
            <div className="connect-card-head">
              Two-way sync <span className="cal-badge">recommended</span>
            </div>
            <p className="settings-hint">
              Sign in with Google and pick your calendars. Events flow both ways: what you add or change
              here lands in Google Calendar (and on your phone), and the other way round.
            </p>
            {showWizard && <GoogleSetupWizard />}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Paste the Client ID from step 5 here…"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
              />
              <button className="btn" onClick={signIn} disabled={busy}>
                <GoogleG size={13} /> {busy && !gcals ? 'Connecting…' : 'Sign in'}
              </button>
            </div>
            <p className="settings-hint" style={{ margin: 0 }}>
              Google will warn that the app “isn’t verified” — that’s normal for a personal app: click{' '}
              <strong>Continue</strong>.{' '}
              <button className="linkish" type="button" onClick={() => setShowWizard((s) => !s)}>
                {showWizard ? 'Hide setup steps' : 'Show the setup steps'}
              </button>
            </p>
            <SignInTroubleshooting />
            {gcals && (
              <>
                <div className="gcal-list">
                  {gcals.map((c) => (
                    <label key={c.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={chosen.has(c.id)}
                        onChange={() =>
                          setChosen((cur) => {
                            const next = new Set(cur);
                            next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                            return next;
                          })
                        }
                      />
                      <span className="dot" style={{ background: c.backgroundColor ?? '#3a5bc7' }} />
                      {c.summary}
                      {c.primary && <span className="cal-badge">primary</span>}
                      {c.readOnly && <span className="cal-badge">read-only</span>}
                    </label>
                  ))}
                </div>
                <button className="btn" onClick={importTwoWay} disabled={busy || chosen.size === 0}>
                  {busy ? 'Connecting…' : `Turn on sync for ${chosen.size} calendar${chosen.size === 1 ? '' : 's'}`}
                </button>
              </>
            )}
          </section>

          {/* ------- option 2: read-only link ------- */}
          <section className="connect-card">
            <div className="connect-card-head">Quick read-only link (1 minute)</div>
            <p className="settings-hint">
              No setup: shows a Google calendar here, but changes made in this app stay in this app.
            </p>
            <ol className="connect-steps">
              <li>
                <strong>Open your Google Calendar settings</strong> and pick a calendar under “Settings for
                my calendars”.
                <a className="btn btn-ghost connect-open" href={GOOGLE_SETTINGS_URL} target="_blank" rel="noreferrer">
                  Open Google Calendar settings ↗
                </a>
              </li>
              <li>
                Scroll to <strong>“Integrate calendar”</strong> and copy the{' '}
                <strong>“Secret address in iCal format”</strong>, then paste it below.
              </li>
            </ol>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Paste the secret address here…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connectReadOnly()}
              />
              <button className="btn btn-ghost" onClick={connectReadOnly} disabled={busy}>
                Connect
              </button>
            </div>
          </section>

          {connected.length > 0 && (
            <div className="settings-section">
              <h3>Connected</h3>
              <div className="gcal-list">
                {connected.map((cal) => (
                  <div key={cal.id} className="check-row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span className="dot" style={{ background: cal.color }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cal.name}
                      </span>
                      <span className="cal-badge">{cal.icsUrl ? 'read-only' : 'two-way'}</span>
                      {cal.syncedAt && (
                        <span style={{ color: 'var(--muted)', fontSize: 11.5, flex: 'none' }}>
                          synced{' '}
                          {new Date(cal.syncedAt).toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </span>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '3px 10px', fontSize: 12, flex: 'none' }}
                      onClick={() => syncNow(cal)}
                      disabled={syncingId === cal.id}
                    >
                      {syncingId === cal.id ? 'Syncing…' : 'Sync now'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
          {okMsg && <p className="ok-text">{okMsg}</p>}
        </div>
      </div>
    </div>
  );
}
