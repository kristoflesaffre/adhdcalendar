import { useEffect, useRef, useState } from 'react';
import type { Occurrence, ViewMode } from '../types';
import type { PendingAlarm } from '../alarm/engine';
import { addDays, fmtDay, fmtFullDay, fmtMonth, fmtOffset, fmtTime, isSameDay, startOfWeek } from '../lib/dates';
import { useStore } from '../state/store';
import { useEventSearch } from '../hooks/useEventSearch';
import { BellFilled, ChevronLeft, ChevronRight, Gear, Plus, SearchIcon } from './icons';
import { LogoMark } from './Logo';

interface Props {
  view: ViewMode;
  date: Date;
  onView: (v: ViewMode) => void;
  onNavigate: (dir: -1 | 0 | 1) => void;
  onCreate: () => void;
  onOpenSettings: () => void;
  onOpenOccurrence: (occ: Occurrence) => void;
  nextAlarm: PendingAlarm | null;
  searchRef: React.RefObject<HTMLInputElement>;
}

function title(view: ViewMode, date: Date, weekStartsOn: 0 | 1): string {
  if (view === 'day') return fmtFullDay(date);
  if (view === 'week') {
    const ws = startOfWeek(date, weekStartsOn);
    const we = addDays(ws, 6);
    if (ws.getMonth() === we.getMonth()) return fmtMonth(ws);
    const a = ws.toLocaleDateString('en-GB', { month: 'short' });
    const b = we.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    return `${a} – ${b}`;
  }
  return fmtMonth(date);
}

export function TopBar({
  view,
  date,
  onView,
  onNavigate,
  onCreate,
  onOpenSettings,
  onOpenOccurrence,
  nextAlarm,
  searchRef,
}: Props) {
  const { state } = useStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutsideClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('click', onOutsideClick);
    return () => window.removeEventListener('click', onOutsideClick);
  }, [open]);

  const hits = useEventSearch(state.events, query);
  const calById = new Map(state.calendars.map((c) => [c.id, c]));

  return (
    <header className="topbar">
      <span className="wordmark">
        <LogoMark size={30} />
        <span className="wordmark-name">
          <em>ADHD</em> Calendar
        </span>
      </span>

      <button className="btn btn-ghost" onClick={() => onNavigate(0)}>
        Today
      </button>
      <span className="nav-group">
        <button className="icon-btn" aria-label="Previous" onClick={() => onNavigate(-1)}>
          <ChevronLeft />
        </button>
        <button className="icon-btn" aria-label="Next" onClick={() => onNavigate(1)}>
          <ChevronRight />
        </button>
      </span>
      <h1 className="topbar-title">{title(view, date, state.settings.weekStartsOn)}</h1>

      <span className="topbar-spacer" />

      {nextAlarm && (
        <span className="next-alarm" title={`${nextAlarm.base.title} — ${fmtOffset(nextAlarm.base.minutesBefore)}`}>
          <BellFilled size={11} />
          Next alarm{' '}
          <span className="mono">
            {isSameDay(nextAlarm.triggerAt, new Date())
              ? fmtTime(nextAlarm.triggerAt)
              : fmtDay(nextAlarm.triggerAt) + ' ' + fmtTime(nextAlarm.triggerAt)}
          </span>
        </span>
      )}

      <div className="search" ref={wrapRef}>
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

      <div className="view-switch" role="group" aria-label="View">
        {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => onView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
            <kbd>{v[0].toUpperCase()}</kbd>
          </button>
        ))}
      </div>

      <button className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
        <Gear size={17} />
      </button>

      <button className="btn" onClick={onCreate}>
        <Plus size={14} />
        New
      </button>
    </header>
  );
}
