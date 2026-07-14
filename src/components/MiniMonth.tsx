import { useEffect, useState } from 'react';
import { addDays, addMonths, fmtMonth, isSameDay, isToday, startOfMonth, startOfWeek } from '../lib/dates';
import { ChevronLeft, ChevronRight } from './icons';

interface Props {
  selected: Date;
  onSelect: (d: Date) => void;
  weekStartsOn: 0 | 1;
  busyDays: Set<string>;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function MiniMonth({ selected, onSelect, weekStartsOn, busyDays }: Props) {
  const [cursor, setCursor] = useState(() => startOfMonth(selected));

  useEffect(() => {
    setCursor(startOfMonth(selected));
  }, [selected.getFullYear(), selected.getMonth()]);

  const gridStart = startOfWeek(cursor, weekStartsOn);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const dows = Array.from({ length: 7 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="mini-month">
      <div className="mini-head">
        <span className="mini-title">{fmtMonth(cursor)}</span>
        <span>
          <button
            className="icon-btn gradient-icon-btn"
            aria-label="Previous month"
            onClick={() => setCursor(addMonths(cursor, -1))}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="icon-btn gradient-icon-btn"
            aria-label="Next month"
            onClick={() => setCursor(addMonths(cursor, 1))}
          >
            <ChevronRight size={14} />
          </button>
        </span>
      </div>
      <div className="mini-grid">
        {dows.map((d) => (
          <div key={d.getDay()} className="mini-dow">
            {d.toLocaleDateString('en-GB', { weekday: 'narrow' })}
          </div>
        ))}
        {cells.map((d) => {
          const out = d.getMonth() !== cursor.getMonth();
          const today = isToday(d);
          const sel = isSameDay(d, selected);
          return (
            <button
              key={d.getTime()}
              className={`mini-cell${out ? ' is-out' : ''}${today ? ' is-today' : sel ? ' is-selected' : ''}`}
              onClick={() => onSelect(d)}
            >
              {d.getDate()}
              {!today && busyDays.has(dayKey(d)) && <span className="busy" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { dayKey };
