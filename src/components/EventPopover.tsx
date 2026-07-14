import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CalendarInfo, Occurrence } from '../types';
import { fmtFullDay, fmtOffset, fmtTimeRange } from '../lib/dates';
import { describeRecurrence } from '../lib/recurrence';
import { useIsMobile } from '../hooks/useIsMobile';
import { Bell, CalIcon, Close, Notes, Pencil, Pin, RingingBell, Trash } from './icons';

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
  const notifications = [...(event.notifications ?? [])].sort((a, b) => b - a);
  const alarms = [...(event.alarms ?? [])].sort((a, b) => b - a);
  const whenText = event.allDay
    ? `${fmtFullDay(occ.start)} · All day`
    : `${fmtFullDay(occ.start)} · ${fmtTimeRange(occ.start, occ.end)}`;

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
      className="icon-btn pop-delete-btn"
      aria-label="Delete"
      onClick={() => setConfirmDelete(true)}
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

        <div className="pop-title-block">
          <span className="pop-color-swatch" style={{ background: color }} />
          <div className="pop-title-copy">
            <h2>{event.title || '(untitled)'}</h2>
            <p className="pop-when">{whenText}</p>
            {event.recurrence && <p className="pop-repeat">{describeRecurrence(event.recurrence)}</p>}
          </div>
        </div>

        {confirmDelete ? (
          <div className="pop-delete-confirm" role="alertdialog" aria-label="Delete event confirmation">
            <strong>{event.recurrence ? 'Delete repeating event?' : 'Delete event?'}</strong>
            <p>
              {event.recurrence
                ? 'Choose whether to delete only this event or the whole series.'
                : 'Are you sure you want to delete this event?'}
            </p>
            <div className="pop-delete-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              {event.recurrence ? (
                <>
                  <button className="btn btn-ghost" onClick={() => onDelete('occurrence')}>
                    This event only
                  </button>
                  <button className="btn btn-danger" onClick={() => onDelete('series')}>
                    Whole series
                  </button>
                </>
              ) : (
                <button className="btn btn-danger" onClick={() => onDelete('series')}>
                  Delete
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="pop-detail-list">
            {event.location && (
              <div className="pop-detail-row">
                <Pin size={18} />
                <div className="pop-detail-main">
                  <span>{event.location}</span>
                </div>
              </div>
            )}

            {event.description && (
              <div className="pop-detail-row">
                <Notes size={18} />
                <div className="pop-detail-main pop-description">
                  <span>{event.description}</span>
                </div>
              </div>
            )}

            {notifications.length > 0 && (
              <div className="pop-detail-row">
                <Bell size={18} />
                <div className="pop-detail-main">
                  <span>Notification</span>
                  <div className="pop-pill-row">
                    {notifications.map((m) => (
                      <span key={m} className="pop-pill">
                        {fmtOffset(m)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="pop-detail-row">
              <RingingBell size={18} />
              <div className="pop-detail-main">
                <span>Alarm</span>
                {alarms.length ? (
                  <div className="pop-pill-row">
                    {alarms.map((m) => (
                      <span key={m} className="pop-pill pop-pill-alarm">
                        {fmtOffset(m)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <small>No alarm</small>
                )}
              </div>
            </div>

            {calendar && (
              <div className="pop-detail-row">
                <CalIcon size={18} />
                <div className="pop-detail-main">
                  <span>{calendar.name}</span>
                  {readOnly && <small>Read-only calendar</small>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
