import { useEffect, useRef, useState } from 'react';
import type { Occurrence, ViewMode } from '../types';
import { useStore } from '../state/store';
import { useEventSearch } from '../hooks/useEventSearch';
import { addDays, fmtDay, fmtMonth, fmtTime, startOfWeek } from '../lib/dates';
import { Close, Menu, SearchIcon } from './icons';

interface Props {
  view: ViewMode;
  date: Date;
  onOpenDrawer: () => void;
  onOpenOccurrence: (occ: Occurrence) => void;
  onJumpToday: () => void;
}

function titleFor(view: ViewMode, date: Date, weekStartsOn: 0 | 1): string {
  if (view === 'day') {
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  if (view === '3day') {
    const end = addDays(date, 2);
    if (date.getMonth() === end.getMonth()) return fmtMonth(date);
    return `${date.toLocaleDateString('en-GB', { month: 'short' })} – ${end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
  }
  if (view === 'week') {
    const ws = startOfWeek(date, weekStartsOn);
    const we = addDays(ws, 6);
    if (ws.getMonth() === we.getMonth()) return fmtMonth(ws);
    return `${ws.toLocaleDateString('en-GB', { month: 'short' })} – ${we.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
  }
  return fmtMonth(date);
}

export function MobileTopBar({ view, date, onOpenDrawer, onOpenOccurrence, onJumpToday }: Props) {
  const { state } = useStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hits = useEventSearch(state.events, query);

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
    else setQuery('');
  }, [searchOpen]);

  const today = new Date().getDate();

  if (searchOpen) {
    return (
      <div className="mobile-search-overlay">
        <div className="mobile-search-bar">
          <SearchIcon size={16} />
          <input
            ref={searchInputRef}
            placeholder="Search events"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
          />
          <button className="icon-btn" aria-label="Close search" onClick={() => setSearchOpen(false)}>
            <Close size={16} />
          </button>
        </div>
        <div className="mobile-search-results">
          {query.trim().length >= 2 && hits.length === 0 && (
            <div className="search-empty">No events match “{query.trim()}”</div>
          )}
          {hits.map((occ) => {
            const cal = state.calendars.find((c) => c.id === occ.event.calendarId);
            return (
              <button
                key={occ.key}
                className="search-hit"
                onClick={() => {
                  setSearchOpen(false);
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
      </div>
    );
  }

  return (
    <header className="mobile-topbar">
      <button className="icon-btn" aria-label="Open menu" onClick={onOpenDrawer}>
        <Menu size={20} />
      </button>

      <span className="mobile-title-plain">{titleFor(view, date, state.settings.weekStartsOn)}</span>

      <span className="topbar-spacer" />

      <button className="icon-btn" aria-label="Search" onClick={() => setSearchOpen(true)}>
        <SearchIcon size={19} />
      </button>
      <button className="icon-btn today-glyph" aria-label="Jump to today" onClick={onJumpToday}>
        <span className="today-glyph-num">{today}</span>
      </button>
    </header>
  );
}
