import { useRef } from 'react';
import type { CalendarInfo, ViewMode } from '../types';
import { EVENT_PALETTE } from '../types';
import { useStore, uid } from '../state/store';
import { parseIcs } from '../lib/ics';
import { MobileDrawer } from './MobileDrawer';
import { LogoMark } from './Logo';
import {
  Gear,
  GoogleG,
  Pencil,
  Plus,
  Upload,
  ViewDay,
  ViewMonth,
  ViewSchedule,
  ViewWeek,
  View3Day,
} from './icons';

interface Props {
  open: boolean;
  view: ViewMode;
  onClose: () => void;
  onView: (v: ViewMode) => void;
  onEditCalendar: (cal: CalendarInfo | null) => void;
  onOpenGoogle: () => void;
  onOpenSettings: () => void;
}

const VIEW_ITEMS: { value: ViewMode; label: string; icon: React.ReactNode }[] = [
  { value: 'schedule', label: 'Schedule', icon: <ViewSchedule size={20} /> },
  { value: 'day', label: 'Day', icon: <ViewDay size={20} /> },
  { value: '3day', label: '3 Day', icon: <View3Day size={20} /> },
  { value: 'week', label: 'Week', icon: <ViewWeek size={20} /> },
  { value: 'month', label: 'Month', icon: <ViewMonth size={20} /> },
];

/** Google Calendar-style slide-out menu for the Calendar tab */
export function MenuDrawer({ open, view, onClose, onView, onEditCalendar, onOpenGoogle, onOpenSettings }: Props) {
  const { state, dispatch } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const importIcs = async (file: File) => {
    const text = await file.text();
    const parsed = parseIcs(text, state.settings.defaultAlarms);
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
    onClose();
  };

  return (
    <MobileDrawer open={open} onClose={onClose}>
      <div className="menu-drawer">
        <div className="menu-logo">
          <LogoMark size={28} />
          <span className="wordmark-name">
            <em>ADHD</em> Calendar
          </span>
        </div>

        <nav className="menu-views" aria-label="View">
          {VIEW_ITEMS.map((item) => (
            <button
              key={item.value}
              className={`menu-view-item${view === item.value ? ' is-active' : ''}`}
              onClick={() => {
                onView(item.value);
                onClose();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="menu-divider" />

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
                className="icon-btn menu-cal-edit"
                style={{ width: 32, height: 32 }}
                aria-label={`Edit ${cal.name}`}
                onClick={() => {
                  onClose();
                  onEditCalendar(cal);
                }}
              >
                <Pencil size={9} />
              </button>
            </li>
          ))}
        </ul>
        <button
          className="menu-row"
          onClick={() => {
            onClose();
            onEditCalendar(null);
          }}
        >
          <Plus size={18} /> Add calendar
        </button>

        <div className="menu-divider" />

        <button
          className="menu-row"
          onClick={() => {
            onClose();
            onOpenGoogle();
          }}
        >
          <GoogleG size={17} /> Connect Google Calendar
        </button>
        <button className="menu-row" onClick={() => fileRef.current?.click()}>
          <Upload size={18} /> Import ICS file
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

        <div className="menu-divider" />

        <button
          className="menu-row"
          onClick={() => {
            onClose();
            onOpenSettings();
          }}
        >
          <Gear size={18} /> Settings
        </button>
      </div>
    </MobileDrawer>
  );
}
