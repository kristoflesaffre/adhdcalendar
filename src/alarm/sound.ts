/**
 * The in-app alarm sound — La Cucaracha on a synthesized marimba, no audio
 * files needed. Mirrors the bundled alarm.wav (scripts/gen-sounds.mjs):
 * same melody, same voice, so the lock-screen ring and the in-app overlay
 * sound like one instrument. Each pass swells a little; every third pass
 * jumps an octave for urgency.
 */

let ctx: AudioContext | null = null;

export function ensureAudioUnlocked(): void {
  // must be called from a user gesture at least once
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/* ---------------- marimba voice ---------------- */

// struck rosewood bar: strong fundamental, bright partial, fast decay
function strike(when: number, hz: number, amp: number, dest: AudioNode): void {
  if (!ctx) return;
  const d1 = 1.0 * Math.sqrt(392 / hz);
  const partials: [number, number, number][] = [
    [1.0, 1.0, d1],
    [3.9, 0.32, d1 * 0.28],
    [9.2, 0.1, d1 * 0.1],
  ];
  for (const [ratio, g, decay] of partials) {
    const f = hz * ratio;
    if (f > 16000) continue;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(g * amp, when + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay + 0.02);
    osc.connect(gain).connect(dest);
    osc.start(when);
    osc.stop(when + decay + 0.08);
  }
}

/* ---------------- La Cucaracha ---------------- */

const G4 = 392.0;
const A4 = 440.0;
const B4 = 493.88;
const C5 = 523.25;
const E5 = 659.25;

// one full pass of the refrain: [freq, beats] — the answer phrase
// ("ya no puede caminar") runs in brisk eighths, as the song wants
const MELODY: [number, number][] = [
  [G4, 0.5], [G4, 0.5], [G4, 0.5], [C5, 1.0], [E5, 1.5],
  [G4, 0.5], [G4, 0.5], [G4, 0.5], [C5, 1.0], [E5, 1.5],
  [C5, 0.5], [C5, 0.5], [B4, 0.5], [B4, 0.5], [A4, 0.5], [A4, 0.5], [G4, 1.5],
];
const BEAT = 0.414; // ≈145 BPM
const PASS_SEC = MELODY.reduce((s, [, b]) => s + b, 0) * BEAT;

export class AlarmBell {
  private master: GainNode | null = null;
  private timer: number | null = null;
  private pass = 0;

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    ensureAudioUnlocked();
    if (!ctx || this.timer !== null) return;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    this.pass = 0;

    const schedulePass = () => {
      if (!ctx || !this.master) return;
      const amp = Math.min(0.55 + this.pass * 0.15, 1.0);
      const octave = this.pass % 4 === 2 ? 2 : 1;
      let t = ctx.currentTime + 0.05;
      for (const [hz, beats] of MELODY) {
        strike(t, hz * octave, amp, this.master);
        t += beats * BEAT;
      }
      this.pass++;
      this.timer = window.setTimeout(schedulePass, PASS_SEC * 1000);
    };
    schedulePass();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.master && ctx) {
      const g = this.master.gain;
      g.setValueAtTime(g.value, ctx.currentTime);
      g.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
      const m = this.master;
      setTimeout(() => m.disconnect(), 400);
      this.master = null;
    }
  }
}

/** Preview for the "Test alarm sound" button: the opening phrase */
export function testStrike(): void {
  ensureAudioUnlocked();
  if (!ctx) return;
  const g = ctx.createGain();
  g.gain.value = 0.5;
  g.connect(ctx.destination);
  let t = ctx.currentTime + 0.02;
  for (const [hz, beats] of MELODY.slice(0, 5)) {
    strike(t, hz, 0.9, g);
    t += beats * BEAT;
  }
  setTimeout(() => g.disconnect(), 5000);
}
