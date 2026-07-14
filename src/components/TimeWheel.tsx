import { useEffect, useRef } from 'react';

/**
 * Scroll-snap hour/minute wheel — the same interaction as the EventSheet's
 * inline picker, packaged for reuse (the alarm editor uses 1-minute steps).
 */

const ROW_H = 48;

export function WheelColumn({
  values,
  selected,
  onSelect,
  render,
}: {
  values: number[];
  selected: number;
  onSelect: (v: number) => void;
  render: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  const suppress = useRef(false);

  useEffect(() => {
    const idx = Math.max(values.indexOf(selected), 0);
    suppress.current = true;
    ref.current?.scrollTo({ top: idx * ROW_H });
    const t = setTimeout(() => (suppress.current = false), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    if (suppress.current) return;
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(values.length - 1, Math.round(el.scrollTop / ROW_H)));
      if (values[idx] !== selected) onSelect(values[idx]);
    }, 90);
  };

  return (
    <div className="twheel-col" ref={ref} onScroll={onScroll}>
      <div className="twheel-pad" />
      {values.map((v) => (
        <button
          key={v}
          className={`twheel-item${v === selected ? ' is-selected' : ''}`}
          onClick={() => {
            const idx = values.indexOf(v);
            ref.current?.scrollTo({ top: idx * ROW_H, behavior: 'smooth' });
            onSelect(v);
          }}
        >
          {render(v)}
        </button>
      ))}
      <div className="twheel-pad" />
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/* each column reports its own change — a combined onChange(hour, minute)
   would capture the OTHER column's value from stale props when two updates
   land close together */
export function ClockWheel({
  hour,
  minute,
  onHour,
  onMinute,
}: {
  hour: number;
  minute: number;
  onHour: (hour: number) => void;
  onMinute: (minute: number) => void;
}) {
  return (
    <div className="twheel">
      <div className="twheel-band" />
      <WheelColumn values={HOURS} selected={hour} onSelect={onHour} render={(v) => String(v)} />
      <WheelColumn
        values={MINUTES}
        selected={minute}
        onSelect={onMinute}
        render={(v) => String(v).padStart(2, '0')}
      />
      <div className="twheel-fade top" />
      <div className="twheel-fade bottom" />
    </div>
  );
}
