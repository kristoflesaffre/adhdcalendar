import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

const EXIT_MS = 240;

/** Slide-out panel that animates both in (via @starting-style) and out
 *  (kept mounted with an is-closing class until the exit finishes). */
export function MobileDrawer({ open, onClose, children }: Props) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, EXIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={`mobile-drawer-backdrop${closing ? ' is-closing' : ''}`}
      onPointerDown={(e) => {
        if (closing) return; // exit in progress: swallow, never re-trigger
        if (e.target === e.currentTarget) onClose();
      }}
      // block every other event from reaching content behind the scrim
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mobile-drawer-panel" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
