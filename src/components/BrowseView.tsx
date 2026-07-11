import type { CalendarInfo } from '../types';
import { Sidebar } from './Sidebar';
import { Gear } from './icons';

interface Props {
  selected: Date;
  onSelectDate: (d: Date) => void;
  onCreate: () => void;
  onEditCalendar: (cal: CalendarInfo | null) => void;
  onOpenGoogle: () => void;
  onOpenSettings: () => void;
  busyDays: Set<string>;
}

/** Todoist-style "Browse" tab: calendars, connections, and settings */
export function BrowseView({ onOpenSettings, ...sidebarProps }: Props) {
  return (
    <div className="browse-page">
      <div className="browse-head">
        <h1 className="today-title">Browse</h1>
        <button className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
          <Gear size={20} />
        </button>
      </div>
      <Sidebar {...sidebarProps} />
    </div>
  );
}
