import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CalendarInfo, Occurrence } from '../types';
import { fmtFullDay, fmtOffset, fmtTimeRange } from '../lib/dates';
import { describeRecurrence } from '../lib/recurrence';
import { useIsMobile } from '../hooks/useIsMobile';
import { BellFilled, Close, Notes, Pencil, Pin, Repeat, Trash } from './icons';

interface Props {
  occ: Occurrence;
  anchor: DOMRect;
  calendar?: CalendarInfo;
  onClose: () => void;
  onEdit: () => void;
  onDelete: (mode: 'occurrence' | 'series') => void;
}

export function EventPopover({ occ, anchor, calendar, onClose, onEdit, onDelete }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { event } = occ;
  const readOnly = calendar?.readOnly;

  useLayoutEffect(() => {
    if (isMobile) return; // the sheet is positioned purely by CSS
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 10;
    let left = anchor.right + margin;
    if (left + w > window.innerWidth - margin) left = anchor.left - w - margin;
    if (left < margin) left = Math.min(Math.max(margin, anchor.left), window.innerWidth - w - margin);
    let top = Math.max(margin, Math.min(anchor.top, window.innerHeight - h - margin));
    setPos({ left, top });
  }, [anchor, confirmDelete, isMobile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // close on *click*, not pointerdown: the full tap gets consumed before
    // the popover unmounts, so it can't fall through to content behind it
    const onOutsideClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('click', onOutsideClick, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('click', onOutsideClick, true);
    };
  }, [onClose]);

  const color = event.color ?? calendar?.color ?? 'var(--accent)';

  const editBtn = !readOnly && (
    <button className="icon-btn" aria-label="Edit" onClick={onEdit}>
      <Pencil size={isMobile ? 17 : 14} />
    </button>
  );
  const deleteBtn = !readOnly && (
    <button
      className="icon-btn"
      aria-label="Delete"
      onClick={() => {
        if (event.recurrence) setConfirmDelete(true);
        else onDelete('series');
      }}
    >
      <Trash size={isMobile ? 17 : 14} />
    </button>
  );
  const closeBtn = (
    <button className="icon-btn" aria-label="Close" onClick={onClose}>
      <Close size={isMobile ? 18 : 14} />
    </button>
  );

  return (
    <>
      {isMobile && <div className="popover-scrim" />}
      <div
        ref={ref}
        className={`popover${isMobile ? ' popover-sheet' : ''}`}
        style={isMobile ? undefined : pos}
        role="dialog"
        aria-label={event.title}
      >
        {isMobile ? (
          <div className="sheet-topbar">
            {closeBtn}
            <span className="right">
              {editBtn}
              {deleteBtn}
            </span>
          </div>
        ) : (
          <div className="popover-actions">
            {editBtn}
            {deleteBtn}
            {closeBtn}
          </div>
        )}

      <div className="pop-row" style={{ padding: 0 }}>
        <span className="dot pop-cal-dot" style={{ background: color }} />
        <div style={{ minWidth: 0 }}>
          <h2>{event.title || '(untitled)'}</h2>
          <p className="pop-when">
            {fmtFullDay(occ.start)}
            {!event.allDay && <> · {fmtTimeRange(occ.start, occ.end)}</>}
            {event.allDay && <> · all day</>}
          </p>
        </div>
      </div>

      {confirmDelete ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
            This is a repeating event.
          </p>
          <button className="btn btn-ghost" onClick={() => onDelete('occurrence')}>
            Delete this event only
          </button>
          <button className="btn btn-danger" style={{ border: '1px solid var(--hairline)' }} onClick={() => onDelete('series')}>
            Delete the whole series
          </button>
        </div>
      ) : (
        <>
          {event.recurrence && (
            <div className="pop-row">
              <Repeat size={14} />
              {describeRecurrence(event.recurrence)}
            </div>
          )}
          {event.location && (
            <div className="pop-row">
              <Pin size={14} />
              {event.location}
            </div>
          )}
          {event.description && (
            <div className="pop-row">
              <Notes size={14} />
              <span style={{ whiteSpace: 'pre-wrap' }}>{event.description}</span>
            </div>
          )}
          <div className="pop-row">
            <span style={{ color: 'var(--muted)', marginTop: 1 }}>
              <BellFilled size={13} />
            </span>
            {event.alarms.length ? (
              <span className="pop-alarms">
                {[...event.alarms]
                  .sort((a, b) => b - a)
                  .map((m) => (
                    <span key={m} className="pop-alarm-tag">
                      <BellFilled size={9} />
                      {fmtOffset(m)}
                    </span>
                  ))}
              </span>
            ) : (
              <span style={{ color: 'var(--muted)' }}>No alarms</span>
            )}
          </div>
          {calendar && (
            <div className="pop-row" style={{ color: 'var(--muted)', fontSize: 12 }}>
              <span className="dot" style={{ background: calendar.color, marginTop: 4 }} />
              {calendar.name}
              {readOnly ? ' · read-only' : ''}
            </div>
          )}
        </>
        )}
      </div>
    </>
  );
}
