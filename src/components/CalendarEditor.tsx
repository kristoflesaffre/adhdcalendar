import { useEffect, useState } from 'react';
import type { CalendarInfo } from '../types';
import { EVENT_PALETTE } from '../types';
import { useStore, uid } from '../state/store';
import { Close } from './icons';

interface Props {
  calendar: CalendarInfo | null; // null = create new
  onClose: () => void;
}

export function CalendarEditor({ calendar, onClose }: Props) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(calendar?.name ?? '');
  const [color, setColor] = useState(
    calendar?.color ?? EVENT_PALETTE[state.calendars.length % EVENT_PALETTE.length].value,
  );
  const [confirming, setConfirming] = useState(false);

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

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (calendar) {
      dispatch({ type: 'calendar/update', calendar: { ...calendar, name: trimmed, color } });
    } else {
      dispatch({
        type: 'calendar/add',
        calendar: { id: `cal-${uid()}`, name: trimmed, color, visible: true, source: 'local' },
      });
    }
    onClose();
  };

  const eventCount = calendar ? state.events.filter((e) => e.calendarId === calendar.id).length : 0;

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 400 }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2 className="modal-title">{calendar ? 'Edit calendar' : 'New calendar'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Close size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div>
            <label className="field-label" htmlFor="cal-name">
              Name
            </label>
            <input
              id="cal-name"
              className="input"
              value={name}
              autoFocus
              placeholder="e.g. Family"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </div>
          <div>
            <span className="field-label">Color</span>
            <div className="swatches">
              {EVENT_PALETTE.map((p) => (
                <button
                  key={p.value}
                  className="swatch"
                  aria-pressed={color === p.value}
                  aria-label={p.name}
                  style={{ background: p.value }}
                  onClick={() => setColor(p.value)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span>
            {calendar &&
              (confirming ? (
                <button className="btn btn-danger" onClick={() => { dispatch({ type: 'calendar/delete', id: calendar.id }); onClose(); }}>
                  Really delete{eventCount ? ` (${eventCount} events)` : ''}?
                </button>
              ) : (
                <button className="btn btn-danger" onClick={() => setConfirming(true)}>
                  Delete
                </button>
              ))}
          </span>
          <span className="right">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" onClick={save} disabled={!name.trim()} style={!name.trim() ? { opacity: 0.5 } : undefined}>
              Save
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
