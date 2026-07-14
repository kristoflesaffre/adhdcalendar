import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ViewMode } from '../types';
import type { PendingAlarm } from '../alarm/engine';
import { addDays, fmtDay, fmtFullDay, fmtMonth, fmtOffset, fmtTime, isSameDay, startOfWeek } from '../lib/dates';
import { useStore } from '../state/store';
import {
  CalIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gear,
  Plus,
  RingingBell,
  TaskIcon,
  ViewDay,
  View3Day,
  ViewMonth,
  ViewSchedule,
  ViewWeek,
} from './icons';
import { LogoMark } from './Logo';

export type DesktopTab = 'calendar' | 'today';

interface Props {
  view: ViewMode;
  tab: DesktopTab;
  date: Date;
  onView: (v: ViewMode) => void;
  onTab: (tab: DesktopTab) => void;
  onNavigate: (dir: -1 | 0 | 1) => void;
  onCreate: () => void;
  onOpenSettings: () => void;
  onOpenNextAlarm: () => void;
  nextAlarm: PendingAlarm | null;
}

function title(view: ViewMode, date: Date, weekStartsOn: 0 | 1): string {
  if (view === 'schedule') return fmtMonth(date);
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

const VIEW_OPTIONS: {
  value: ViewMode;
  label: string;
  shortcut: string;
  icon: ReactNode;
}[] = [
  { value: 'day', label: 'Day', shortcut: 'D', icon: <ViewDay size={17} /> },
  { value: 'week', label: 'Week', shortcut: 'W', icon: <ViewWeek size={17} /> },
  { value: 'month', label: 'Month', shortcut: 'M', icon: <ViewMonth size={17} /> },
  { value: 'schedule', label: 'Schedule', shortcut: 'A', icon: <ViewSchedule size={17} /> },
  { value: '3day', label: '3 days', shortcut: 'X', icon: <View3Day size={17} /> },
];

function viewLabel(view: ViewMode): string {
  return VIEW_OPTIONS.find((option) => option.value === view)?.label ?? 'Week';
}

export function TopBar({
  view,
  tab,
  date,
  onView,
  onTab,
  onNavigate,
  onCreate,
  onOpenSettings,
  onOpenNextAlarm,
  nextAlarm,
}: Props) {
  const { state } = useStore();
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewOpen) return;
    const onOutsideClick = (e: MouseEvent) => {
      if (!viewRef.current?.contains(e.target as Node)) setViewOpen(false);
    };
    window.addEventListener('click', onOutsideClick);
    return () => window.removeEventListener('click', onOutsideClick);
  }, [viewOpen]);

  return (
    <header className="topbar">
      <span className="wordmark">
        <LogoMark size={30} />
        <span className="wordmark-name">
          <em>ADHD</em> Calendar
        </span>
      </span>

      <button className="btn btn-ghost today-pill" onClick={() => onNavigate(0)}>
        Today
      </button>
      <span className="nav-group">
        <button className="icon-btn gradient-icon-btn" aria-label="Previous" onClick={() => onNavigate(-1)}>
          <ChevronLeft />
        </button>
        <button className="icon-btn gradient-icon-btn" aria-label="Next" onClick={() => onNavigate(1)}>
          <ChevronRight />
        </button>
      </span>
      <h1 className="topbar-title">{title(view, date, state.settings.weekStartsOn)}</h1>

      {nextAlarm && (
        <button
          className="next-alarm"
          title={`${nextAlarm.base.title} — ${fmtOffset(nextAlarm.base.minutesBefore)}`}
          onClick={onOpenNextAlarm}
        >
          <RingingBell size={11} />
          Next alarm{' '}
          <span className="mono">
            {isSameDay(nextAlarm.triggerAt, new Date())
              ? fmtTime(nextAlarm.triggerAt)
              : fmtDay(nextAlarm.triggerAt) + ' ' + fmtTime(nextAlarm.triggerAt)}
          </span>
        </button>
      )}

      <span className="topbar-spacer" />

      <div className="view-menu-wrap" ref={viewRef}>
        <button
          className="view-menu-button"
          aria-haspopup="menu"
          aria-expanded={viewOpen}
          onClick={() => setViewOpen((value) => !value)}
        >
          {viewLabel(view)}
          <ChevronDown size={14} />
        </button>
        {viewOpen && (
          <div className="view-menu" role="menu" aria-label="Calendar view">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                role="menuitemradio"
                aria-checked={view === option.value}
                className={view === option.value ? 'is-active' : ''}
                onClick={() => {
                  onView(option.value);
                  onTab('calendar');
                  setViewOpen(false);
                }}
              >
                <span className="view-menu-check">{view === option.value ? '✓' : ''}</span>
                <span className="view-menu-icon">{option.icon}</span>
                <span>{option.label}</span>
                <kbd>{option.shortcut}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`desktop-tabs is-${tab}`} role="tablist" aria-label="Section">
        <span className="desktop-tab-indicator" aria-hidden="true" />
        <button
          role="tab"
          aria-selected={tab === 'calendar'}
          className={tab === 'calendar' ? 'is-active' : ''}
          onClick={() => onTab('calendar')}
        >
          <CalIcon size={17} />
          Calendar
        </button>
        <button
          role="tab"
          aria-selected={tab === 'today'}
          className={tab === 'today' ? 'is-active' : ''}
          onClick={() => onTab('today')}
        >
          <TaskIcon size={17} />
          Today
        </button>
      </div>

      <button className="icon-btn gradient-icon-btn" aria-label="Settings" onClick={onOpenSettings}>
        <Gear size={17} />
      </button>

      <button className="btn new-btn" onClick={onCreate}>
        <Plus size={14} />
        New
      </button>
    </header>
  );
}
