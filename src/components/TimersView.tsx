import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ActiveTimer } from '../types';
import { uid } from '../state/store';
import { ensureAudioUnlocked } from '../alarm/sound';
import { easeScrollIntoView } from '../lib/scroll';
import { WheelColumn } from './TimeWheel';
import { ChevronDown, Close, PauseIcon, PlayIcon, TimerIcon } from './icons';

interface Props {
  timers: ActiveTimer[];
  onStart: (timer: ActiveTimer) => void;
  onCancel: (id: string) => void;
  onPause: (id: string, remaining: number) => void;
  onResume: (id: string, endAt: number) => void;
}

/**
 * Digital take on the flip-cube pomodoro timer: a grid of colored cube
 * faces — tap one and it's running, zero fuss. Color IS information: the
 * hue ramps from mint (5 min) to plum (60 min), and a running card keeps
 * its cube's color. The full-width Custom strip carries the whole 5→60
 * spectrum and morphs open into an iOS-style wheel. A finished timer
 * rings through the real-alarm engine, locked phone included.
 */

const PRESETS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;
const CUSTOM_HOURS = Array.from({ length: 9 }, (_, i) => i);
const CUSTOM_MINUTES = Array.from({ length: 60 }, (_, i) => i);
/** matches the .timer-custom-body grid-rows transition duration */
const CUSTOM_EXPAND_MS = 420;
/** matches the card slide-out + slot collapse choreography */
const CARD_EXIT_MS = 470;

/** mint (short) → plum (long); the grid reads as a set of colored cubes */
function hueFor(minutes: number): number {
  const t = Math.min(1, Math.max(0, (minutes - 5) / 55));
  return Math.round(150 + t * 125);
}

function fmtRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Grid-rows wrapper that choreographs a card's entrance and exit: the slot
 * expands first (pushing the list down with easing), then the card slides
 * in from the left; leaving reverses both, card first.
 */
function TimerCardSlot({ children, leaving }: { children: ReactNode; leaving: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // double-rAF guarantees the closed state painted once (so the
    // transition runs); the timeout is a fallback for throttled tabs
    let done = false;
    const fire = () => {
      if (!done) {
        done = true;
        setOpen(true);
      }
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(fire));
    const to = window.setTimeout(fire, 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(to);
    };
  }, []);
  return (
    <div className={`timer-card-slot${open && !leaving ? ' is-open' : ''}`}>
      <div className="timer-card-slot-inner">{children}</div>
    </div>
  );
}

export function TimersView({ timers, onStart, onCancel, onPause, onResume }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [customOpen, setCustomOpen] = useState(false);
  const [wheelMounted, setWheelMounted] = useState(false);
  const [customH, setCustomH] = useState(0);
  const [customM, setCustomM] = useState(12);
  const customRef = useRef<HTMLDivElement>(null);
  const customTimers = useRef<number[]>([]);

  const anyRunning = timers.some((t) => t.pausedRemaining == null);
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [anyRunning]);

  useEffect(() => () => customTimers.current.forEach((id) => clearTimeout(id)), []);

  const toggleCustom = () => {
    customTimers.current.forEach((id) => clearTimeout(id));
    customTimers.current = [];
    if (customOpen) {
      setCustomOpen(false);
      setWheelMounted(false);
      return;
    }
    setCustomOpen(true);
    // the wheel mounts only once the panel has its full height, so the
    // mount-scroll centers correctly
    customTimers.current.push(
      window.setTimeout(() => setWheelMounted(true), CUSTOM_EXPAND_MS + 10),
      // scroll DURING the expansion: measure the height the collapsed body
      // is about to gain and tween to the final position right away
      window.setTimeout(() => {
        const el = customRef.current;
        if (!el) return;
        const inner = el.querySelector<HTMLElement>('.timer-custom-body-inner');
        const extra = inner ? Math.max(0, inner.scrollHeight - inner.clientHeight) : 0;
        easeScrollIntoView(el, 110, CUSTOM_EXPAND_MS, extra);
      }, 30),
    );
  };

  const start = (minutes: number) => {
    ensureAudioUnlocked(); // a user gesture — unlock audio so the ring is loud
    const t = Date.now();
    const label =
      minutes >= 60 && minutes % 60 === 0
        ? `${minutes / 60} h`
        : minutes > 60
          ? `${Math.floor(minutes / 60)} h ${minutes % 60} min`
          : `${minutes} min`;
    onStart({
      id: uid(),
      label,
      totalMs: minutes * 60_000,
      startedAt: t,
      endAt: t + minutes * 60_000,
      hue: hueFor(minutes),
    });
    setNow(t);
  };

  const customTotal = customH * 60 + customM;

  const remove = (id: string) => {
    setLeaving((cur) => new Set(cur).add(id));
    window.setTimeout(() => {
      setLeaving((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
      onCancel(id);
    }, CARD_EXIT_MS);
  };

  const sorted = useMemo(
    () =>
      [...timers].sort(
        (a, b) =>
          (a.pausedRemaining ?? a.endAt - now) - (b.pausedRemaining ?? b.endAt - now),
      ),
    [timers, now],
  );

  return (
    <div className="today-page timers-page">
      <div className="today-head">
        <h1 className="today-title">Timers</h1>
        <p className="today-date">
          {timers.length === 0
            ? 'Tap a tile — it starts instantly'
            : `${timers.length} running`}
        </p>
      </div>

      <div className="timer-cards">
        {sorted.map((timer) => {
          const remaining = timer.pausedRemaining ?? timer.endAt - now;
          const done = remaining <= 0 && timer.pausedRemaining == null;
          const ending = !done && timer.pausedRemaining == null && remaining < 60_000;
          const progress = Math.min(1, Math.max(0, 1 - remaining / timer.totalMs));
          const paused = timer.pausedRemaining != null;
          return (
            <TimerCardSlot key={timer.id} leaving={leaving.has(timer.id)}>
              <div
                className={`timer-card${done ? ' is-done' : ''}${paused ? ' is-paused' : ''}${
                  ending ? ' is-ending' : ''
                }`}
                style={{ ['--th' as any]: timer.hue ?? 210 }}
              >
                <svg className="timer-ring" viewBox="0 0 40 40" aria-hidden="true">
                  <circle className="timer-ring-track" cx="20" cy="20" r={RING_R} />
                  <circle
                    className="timer-ring-fill"
                    cx="20"
                    cy="20"
                    r={RING_R}
                    strokeDasharray={RING_C}
                    strokeDashoffset={done ? 0 : RING_C * (1 - progress)}
                  />
                </svg>
                <div className="timer-card-copy">
                  <span className="timer-remaining">{done ? '0:00' : fmtRemaining(remaining)}</span>
                  <span className="timer-card-label">
                    {done ? 'Done — ringing' : paused ? `${timer.label} · paused` : timer.label}
                  </span>
                </div>
                {!done && (
                  <button
                    className="timer-btn"
                    aria-label={paused ? 'Resume timer' : 'Pause timer'}
                    onClick={() =>
                      paused
                        ? onResume(timer.id, Date.now() + (timer.pausedRemaining ?? 0))
                        : onPause(timer.id, Math.max(0, timer.endAt - Date.now()))
                    }
                  >
                    {paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
                  </button>
                )}
                <button
                  className="timer-btn timer-btn-x"
                  aria-label="Remove timer"
                  onClick={() => remove(timer.id)}
                >
                  <Close size={18} />
                </button>
              </div>
            </TimerCardSlot>
          );
        })}
      </div>

      <div className="timer-grid">
        {PRESETS.map((minutes, i) => (
          <button
            key={minutes}
            className="timer-tile"
            style={{ ['--th' as any]: hueFor(minutes), animationDelay: `${i * 24}ms` }}
            onClick={() => start(minutes)}
          >
            <span className="timer-tile-num">{minutes}</span>
            <span className="timer-tile-unit">min</span>
          </button>
        ))}

        {/* full-width strip carrying the whole 5→60 spectrum; it morphs
            open into the wheel — the content lives inside the button */}
        <div
          ref={customRef}
          className={`timer-custom${customOpen ? ' is-open' : ''}`}
          style={{
            ['--th' as any]: hueFor(customTotal),
            animationDelay: `${PRESETS.length * 24}ms`,
          }}
        >
          <button className="timer-custom-head" aria-expanded={customOpen} onClick={toggleCustom}>
            <TimerIcon size={22} />
            <span className="timer-custom-title">Custom</span>
            <span className={`timer-custom-chev${customOpen ? ' is-open' : ''}`}>
              <ChevronDown size={20} />
            </span>
          </button>
          <div className="timer-custom-body">
            <div className="timer-custom-body-inner">
              <div className="timer-custom-stage">
                {wheelMounted && (
                  <div className="twheel timer-custom-wheel">
                    <div className="twheel-band" />
                    <div className="timer-wheel-group">
                      <WheelColumn
                        values={CUSTOM_HOURS}
                        selected={customH}
                        onSelect={setCustomH}
                        render={(v) => String(v)}
                      />
                      <span className="timer-wheel-unit">hours</span>
                    </div>
                    <div className="timer-wheel-group">
                      <WheelColumn
                        values={CUSTOM_MINUTES}
                        selected={customM}
                        onSelect={setCustomM}
                        render={(v) => String(v)}
                      />
                      <span className="timer-wheel-unit">min</span>
                    </div>
                    <div className="twheel-fade top" />
                    <div className="twheel-fade bottom" />
                  </div>
                )}
              </div>
              <button
                className="timer-custom-start"
                disabled={customTotal === 0}
                onClick={() => {
                  toggleCustom();
                  start(customTotal);
                }}
              >
                Start{' '}
                {customTotal > 0 &&
                  (customH > 0 ? `${customH} h ${customM} min` : `${customM} min`)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
