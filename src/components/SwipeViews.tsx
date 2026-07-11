import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  /** render one period; offset -1 = previous, 0 = current, 1 = next */
  renderPanel: (offset: -1 | 0 | 1) => ReactNode;
  /** called when a swipe commits; dir 1 = forward to the next period */
  onNavigate: (dir: -1 | 1) => void;
  /** identity of the current period — a change snaps the track home */
  periodKey: number;
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SNAP_MS = 280;
const LOCK_DISTANCE = 12;
const COMMIT_FRACTION = 0.28;
const COMMIT_VELOCITY = 0.45; // px per ms

type Phase =
  | { kind: 'idle' }
  | { kind: 'drag'; dx: number }
  | { kind: 'settle'; dir: -1 | 0 | 1 };

/**
 * Google Calendar-style horizontal paging: previous/current/next periods
 * sit side by side in a 300%-wide track that follows the finger, then
 * snaps with an eased animation. Vertical scrolling and event-block
 * dragging inside the panels keep working (axis lock + target checks).
 */
export function SwipeViews({ renderPanel, onNavigate, periodKey }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const gesture = useRef<{
    startX: number;
    startY: number;
    startT: number;
    locked: 'h' | 'v' | null;
    ignore: boolean;
  } | null>(null);

  // period changed (swipe committed or external nav): snap track home
  useEffect(() => {
    setPhase({ kind: 'idle' });
  }, [periodKey]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (phaseRef.current.kind === 'settle') return;
      const t = e.touches[0];
      const target = e.target as HTMLElement;
      gesture.current = {
        startX: t.clientX,
        startY: t.clientY,
        startT: Date.now(),
        locked: null,
        // dragging an event block must win from page-swiping
        ignore: !!target.closest('.tg-event') || e.touches.length > 1,
      };
    };

    const onMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (!g || g.ignore || phaseRef.current.kind === 'settle') return;
      const t = e.touches[0];
      const moveX = t.clientX - g.startX;
      const moveY = t.clientY - g.startY;
      if (!g.locked) {
        if (Math.abs(moveX) < LOCK_DISTANCE && Math.abs(moveY) < LOCK_DISTANCE) return;
        g.locked = Math.abs(moveX) > Math.abs(moveY) * 1.3 ? 'h' : 'v';
      }
      if (g.locked !== 'h') return;
      e.preventDefault();
      setPhase({ kind: 'drag', dx: moveX });
    };

    const onEnd = () => {
      const g = gesture.current;
      gesture.current = null;
      const cur = phaseRef.current;
      if (!g || g.locked !== 'h' || cur.kind !== 'drag') return;
      const width = el.clientWidth || 1;
      const velocity = Math.abs(cur.dx) / Math.max(Date.now() - g.startT, 1);
      const commit = Math.abs(cur.dx) > width * COMMIT_FRACTION || velocity > COMMIT_VELOCITY;
      // dragging left (dx < 0) reveals the NEXT period
      setPhase({ kind: 'settle', dir: commit ? (cur.dx < 0 ? 1 : -1) : 0 });
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // when a commit animation finishes, actually navigate (or just settle home)
  useEffect(() => {
    if (phase.kind !== 'settle') return;
    const { dir } = phase;
    const id = window.setTimeout(() => {
      if (dir === 0) setPhase({ kind: 'idle' });
      else onNavigate(dir); // periodKey change resets the track
    }, SNAP_MS);
    return () => clearTimeout(id);
  }, [phase, onNavigate]);

  const transform =
    phase.kind === 'drag'
      ? `translateX(calc(-100% + ${phase.dx}px))`
      : phase.kind === 'settle'
        ? `translateX(${-100 - phase.dir * 100}%)`
        : 'translateX(-100%)';

  return (
    <div ref={wrapRef} className="swipe-views">
      <div
        className="swipe-track"
        style={{
          transform,
          transition: phase.kind === 'settle' ? `transform ${SNAP_MS}ms ${EASE}` : 'none',
        }}
      >
        <div className="swipe-panel">{renderPanel(-1)}</div>
        <div className="swipe-panel">{renderPanel(0)}</div>
        <div className="swipe-panel">{renderPanel(1)}</div>
      </div>
    </div>
  );
}
