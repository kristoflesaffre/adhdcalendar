import { useEffect, useRef, useState } from 'react';
import type { Occurrence, ViewMode } from '../types';
import { useStore } from '../state/store';
import { useEventSearch } from '../hooks/useEventSearch';
import { fmtDay, fmtTime } from '../lib/dates';
import { MiniMonth } from './MiniMonth';
import { ChevronDown, Close, Menu, SearchIcon } from './icons';

interface Props {
  view: ViewMode;
  date: Date;
  busyDays: Set<string>;
  onOpenDrawer: () => void;
  onSelectDate: (d: Date) => void;
  onOpenOccurrence: (occ: Occurrence) => void;
  onJumpToday: () => void;
}

/** Google iOS shows just the month; the year only when it isn't this year */
function monthTitle(date: Date): string {
  const month = date.toLocaleDateString('en-GB', { month: 'long' });
  return date.getFullYear() === new Date().getFullYear()
    ? month
    : `${month} ${date.getFullYear()}`;
}

export function MobileTopBar({
  view: _view,
  date,
  busyDays,
  onOpenDrawer,
  onSelectDate,
  onOpenOccurrence,
  onJumpToday,
}: Props) {
  const { state } = useStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [monthOpen, setMonthOpen] = useState(false);
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
    <div className="month-drop-wrap">
      <header className="mobile-topbar">
        <button className="icon-btn" aria-label="Open menu" onClick={onOpenDrawer}>
          <Menu size={20} />
        </button>

        {/* Google iOS: "July ⌄" pulls down a month grid */}
        <button
          className="mobile-title-btn"
          aria-expanded={monthOpen}
          onClick={() => setMonthOpen((o) => !o)}
        >
          {monthTitle(date)}
          <span className="chev" style={{ display: 'inline-flex' }}>
            <ChevronDown size={16} />
          </span>
        </button>

        <span className="topbar-spacer" />

        <button className="icon-btn" aria-label="Search" onClick={() => setSearchOpen(true)}>
          <SearchIcon size={19} />
        </button>
        <button className="icon-btn today-glyph" aria-label="Jump to today" onClick={onJumpToday}>
          <span className="today-glyph-num">{today}</span>
        </button>
      </header>

      {monthOpen && (
        <>
          <div className="month-drop-scrim" onPointerDown={() => setMonthOpen(false)} />
          <div className="month-drop">
            <MiniMonth
              selected={date}
              onSelect={(d) => {
                setMonthOpen(false);
                onSelectDate(d);
              }}
              weekStartsOn={state.settings.weekStartsOn}
              busyDays={busyDays}
            />
          </div>
        </>
      )}
    </div>
  );
}
