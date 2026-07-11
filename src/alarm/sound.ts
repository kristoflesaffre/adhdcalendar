import { getAlarmSound } from './sounds';

/**
 * Foreground alarm audio. User-selected WAV files are played through Web
 * Audio so the in-app overlay matches the native iOS ring. The old marimba
 * phrase stays as a fallback if a browser cannot fetch or decode the file.
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
const bufferCache = new Map<string, Promise<AudioBuffer>>();

async function loadAlarmBuffer(soundId?: string): Promise<AudioBuffer> {
  ensureAudioUnlocked();
  if (!ctx) throw new Error('AudioContext unavailable');
  const sound = getAlarmSound(soundId);
  let promise = bufferCache.get(sound.id);
  if (!promise) {
    promise = fetch(sound.webUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Unable to load ${sound.fileName}`);
        return res.arrayBuffer();
      })
      .then((data) => ctx!.decodeAudioData(data));
    bufferCache.set(sound.id, promise);
  }
  return promise;
}

export class AlarmBell {
  private master: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private timer: number | null = null;
  private pass = 0;
  private run = 0;

  get playing(): boolean {
    return this.master !== null;
  }

  start(soundId?: string): void {
    ensureAudioUnlocked();
    if (!ctx || this.master) return;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);
    this.pass = 0;
    this.run++;
    const run = this.run;

    void this.startFileLoop(soundId, run);
  }

  stop(): void {
    this.run++;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source.disconnect();
      this.source = null;
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

  private async startFileLoop(soundId: string | undefined, run: number): Promise<void> {
    try {
      const buffer = await loadAlarmBuffer(soundId);
      if (!ctx || !this.master || this.run !== run) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.master);
      source.start();
      this.source = source;
    } catch {
      if (this.run === run) this.scheduleSyntheticPass();
    }
  }

  private scheduleSyntheticPass(): void {
    if (!ctx || !this.master) return;
    const amp = Math.min(0.55 + this.pass * 0.15, 1.0);
    const octave = this.pass % 4 === 2 ? 2 : 1;
    let t = ctx.currentTime + 0.05;
    for (const [hz, beats] of MELODY) {
      strike(t, hz * octave, amp, this.master);
      t += beats * BEAT;
    }
    this.pass++;
    this.timer = window.setTimeout(() => this.scheduleSyntheticPass(), PASS_SEC * 1000);
  }
}

/** Preview for the "Test alarm sound" button. */
export function testStrike(soundId?: string): void {
  ensureAudioUnlocked();
  if (!ctx) return;
  const run = Date.now();
  void playFilePreview(soundId, run);
}

async function playFilePreview(soundId: string | undefined, run: number): Promise<void> {
  try {
    const buffer = await loadAlarmBuffer(soundId);
    if (!ctx || run === 0) return;
    const g = ctx.createGain();
    g.gain.value = 0.85;
    g.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(g);
    source.start();
    source.stop(ctx.currentTime + 5);
    setTimeout(() => g.disconnect(), 5400);
  } catch {
    playSyntheticPreview();
  }
}

function playSyntheticPreview(): void {
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
