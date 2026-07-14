import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { CalendarInfo, Occurrence } from '../types';
import { useStore, uid } from '../state/store';
import { parseIcs } from '../lib/ics';
import { EVENT_PALETTE } from '../types';
import { flushQueue, getSyncStatus, subscribeSync } from '../lib/googleSync';
import type { SyncPhase } from '../lib/googleSync';
import { fmtDay, fmtTime } from '../lib/dates';
import { useEventSearch } from '../hooks/useEventSearch';
import { MiniMonth } from './MiniMonth';
import { GoogleG, Pencil, Plus, SearchIcon, Upload } from './icons';

function SyncPill() {
  const { state, dispatch } = useStore();
  const [status, setStatus] = useState(getSyncStatus());

  useEffect(() => subscribeSync(setStatus), []);

  if (status.pending === 0) return null;
  const phase: SyncPhase = status.phase;

  return (
    <button
      className="sync-pill"
      onClick={() =>
        void flushQueue(state.settings.googleClientId, (id, googleEventId) =>
          dispatch({ type: 'event/patch', id, patch: { googleEventId } }),
        )
      }
      title="Changes made here that still have to reach Google Calendar"
    >
      <span className={`sync-dot${phase === 'syncing' ? ' is-syncing' : ''}`} />
      {phase === 'syncing'
        ? 'Syncing to Google…'
        : `${status.pending} change${status.pending > 1 ? 's' : ''} to sync — ${
            phase === 'signin-needed' ? 'sign in' : 'retry'
          }`}
    </button>
  );
}

interface Props {
  selected: Date;
  onSelectDate: (d: Date) => void;
  onCreate: () => void;
  onEditCalendar: (cal: CalendarInfo | null) => void;
  onOpenGoogle: () => void;
  onOpenOccurrence?: (occ: Occurrence) => void;
  busyDays: Set<string>;
  searchRef?: RefObject<HTMLInputElement>;
}

function SidebarSearch({
  onOpenOccurrence,
  searchRef,
}: {
  onOpenOccurrence: (occ: Occurrence) => void;
  searchRef: RefObject<HTMLInputElement>;
}) {
  const { state } = useStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hits = useEventSearch(state.events, query);
  const calById = new Map(state.calendars.map((c) => [c.id, c]));

  useEffect(() => {
    if (!open) return;
    const onOutsideClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('click', onOutsideClick);
    return () => window.removeEventListener('click', onOutsideClick);
  }, [open]);

  return (
    <div className="search sidebar-search" ref={wrapRef}>
      <SearchIcon size={14} />
      <input
        ref={searchRef}
        placeholder="Search events"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {open && query.trim().length >= 2 && (
        <div className="search-results">
          {hits.length === 0 && <div className="search-empty">No events match “{query.trim()}”</div>}
          {hits.map((occ) => {
            const cal = calById.get(occ.event.calendarId);
            return (
              <button
                key={occ.key}
                className="search-hit"
                onClick={() => {
                  setOpen(false);
                  onOpenOccurrence(occ);
                }}
              >
                <span className="dot" style={{ background: occ.event.color ?? cal?.color }} />
                <span style={{ minWidth: 0 }}>
                  <div className="search-hit-title">{occ.event.title || '(untitled)'}</div>
                  <div className="search-hit-when">
                    {fmtDay(occ.start)}
                    {occ.event.allDay ? '' : ` · ${fmtTime(occ.start)}`}
                  </div>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  selected,
  onSelectDate,
  onCreate,
  onEditCalendar,
  onOpenGoogle,
  onOpenOccurrence,
  busyDays,
  searchRef,
}: Props) {
  const { state, dispatch } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const importIcs = async (file: File) => {
    const text = await file.text();
    const parsed = parseIcs(
      text,
      state.settings.defaultAlarms,
      state.settings.defaultNotifications,
    );
    const calId = `ics-${uid()}`;
    const usedColors = new Set(state.calendars.map((c) => c.color));
    const color =
      EVENT_PALETTE.find((p) => !usedColors.has(p.value))?.value ??
      EVENT_PALETTE[state.calendars.length % EVENT_PALETTE.length].value;
    dispatch({
      type: 'calendar/importEvents',
      calendar: {
        id: calId,
        name: parsed.calendarName || file.name.replace(/\.ics$/i, ''),
        color,
        visible: true,
        source: 'ics',
      },
      events: parsed.events.map((e) => ({ ...e, calendarId: calId })),
    });
  };

  return (
    <aside className="sidebar">
      {onOpenOccurrence && searchRef && (
        <SidebarSearch onOpenOccurrence={onOpenOccurrence} searchRef={searchRef} />
      )}

      <button className="btn create-btn" onClick={onCreate}>
        <Plus size={15} />
        New event
      </button>

      <MiniMonth
        selected={selected}
        onSelect={onSelectDate}
        weekStartsOn={state.settings.weekStartsOn}
        busyDays={busyDays}
      />

      <section>
        <h3 className="side-label">My calendars</h3>
        <ul className="cal-list">
          {state.calendars.map((cal) => (
            <li key={cal.id} className="cal-item" style={{ ['--cal-color' as any]: cal.color }}>
              <input
                type="checkbox"
                className="cal-check"
                checked={cal.visible}
                onChange={() => dispatch({ type: 'calendar/toggle', id: cal.id })}
                aria-label={`Show ${cal.name}`}
              />
              <span className="cal-name" title={cal.name}>
                {cal.name}
              </span>
              {cal.source !== 'local' && (
                <span className="cal-badge">
                  {cal.icsUrl ? 'read-only' : cal.source === 'google' ? '2-way' : cal.source}
                </span>
              )}
              <button
                className="cal-edit-btn"
                aria-label={`Edit ${cal.name}`}
                title={`Edit ${cal.name}`}
                onClick={() => onEditCalendar(cal)}
              >
                <Pencil size={12} />
              </button>
            </li>
          ))}
        </ul>
        <button
          className="btn btn-ghost"
          style={{ border: 0, color: 'var(--muted)', paddingLeft: 8, marginTop: 2 }}
          onClick={() => onEditCalendar(null)}
        >
          <Plus size={13} /> Add calendar
        </button>
      </section>

      <section className="side-import">
        <h3 className="side-label">Connect</h3>
        <SyncPill />
        <button className="btn btn-ghost" onClick={onOpenGoogle}>
          <GoogleG /> Google Calendar…
        </button>
        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> ICS file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importIcs(f);
            e.target.value = '';
          }}
        />
      </section>
    </aside>
  );
}
