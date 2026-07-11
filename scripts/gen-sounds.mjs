// Renders the alarm melody — La Cucaracha on a marimba — to a real WAV
// file, since iOS notification sounds and background audio need an actual
// bundled audio file. The in-app overlay (src/alarm/sound.ts) plays the
// same melody live via Web Audio; keep the two in sync.
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;

/* ---------------- marimba voice ---------------- */

// struck rosewood bar: strong fundamental, bright 4th-ish partial, fast
// pitch-dependent decay, tiny mallet click
function marimbaNote(hz, amp = 1) {
  const d1 = 1.0 * Math.sqrt(392 / hz); // lower bars ring longer
  const dur = d1 + 0.15;
  const n = Math.floor(SR * dur);
  const out = new Float64Array(n);
  const partials = [
    [1.0, 1.0, d1],
    [3.9, 0.32, d1 * 0.28],
    [9.2, 0.1, d1 * 0.1],
  ];
  const attack = 0.003;
  for (const [ratio, gain, decay] of partials) {
    const f = hz * ratio;
    if (f > SR / 2 - 2000) continue;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env =
        t < attack ? (t / attack) * gain : gain * Math.exp((-(t - attack) * 6.9) / decay);
      out[i] += amp * env * Math.sin(2 * Math.PI * f * t);
    }
  }
  // mallet click
  const clickN = Math.floor(SR * 0.004);
  for (let i = 0; i < clickN; i++) {
    out[i] += amp * 0.06 * (Math.random() * 2 - 1) * (1 - i / clickN);
  }
  return out;
}

/* ---------------- La Cucaracha ---------------- */

const G4 = 392.0;
const A4 = 440.0;
const B4 = 493.88;
const C5 = 523.25;
const E5 = 659.25;

// one full pass of the refrain: [freq, beats] — the answer phrase
// ("ya no puede caminar") runs in brisk eighths, as the song wants
const MELODY = [
  [G4, 0.5], [G4, 0.5], [G4, 0.5], [C5, 1.0], [E5, 1.5],
  [G4, 0.5], [G4, 0.5], [G4, 0.5], [C5, 1.0], [E5, 1.5],
  [C5, 0.5], [C5, 0.5], [B4, 0.5], [B4, 0.5], [A4, 0.5], [A4, 0.5], [G4, 1.5],
];
const BEAT = 0.414; // ≈145 BPM
const PASS_BEATS = MELODY.reduce((s, [, b]) => s + b, 0); // 14 beats

/**
 * ~29s: four passes of the refrain, each a little louder, the third an
 * octave up for urgency. 29s because iOS caps notification sounds at 30s —
 * and it loops as the continuous background alarm.
 */
function synthCucaracha(totalSec) {
  const n = Math.floor(SR * totalSec);
  const out = new Float64Array(n);
  const passDur = PASS_BEATS * BEAT;
  const passes = Math.floor((totalSec - 1.2) / passDur); // leave tail room
  for (let p = 0; p < passes; p++) {
    const amp = Math.min(0.55 + p * 0.15, 1.0);
    const octave = p % 4 === 2 ? 2 : 1;
    let t = 0.2 + p * passDur;
    for (const [hz, beats] of MELODY) {
      const note = marimbaNote(hz * octave, amp);
      const off = Math.floor(t * SR);
      for (let j = 0; j < note.length && off + j < n; j++) out[off + j] += note[j];
      t += beats * BEAT;
    }
  }
  return out;
}

function synthQuietKeepAlive(durationSec) {
  const n = Math.floor(SR * durationSec);
  const samples = new Float64Array(n);
  // extremely quiet, inaudible tone — just enough for iOS to treat the
  // audio session as genuinely playing so the background-audio mode holds
  for (let i = 0; i < n; i++) {
    samples[i] = 0.0025 * Math.sin((2 * Math.PI * 30 * i) / SR);
  }
  return samples;
}

function toWav(samples, outPath) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0.85 ? 0.85 / peak : 1;
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * norm));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  const byteRate = SR * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.concat([header, pcm]));
  console.log(`wrote ${outPath} (${(pcm.length / byteRate).toFixed(2)}s)`);
}

const root = path.resolve(import.meta.dirname, '..');
// two copies: Xcode's "Add Files" duplicated the originals into ios/App/,
// and that's what the target actually bundles — keep both in sync
const melody = synthCucaracha(29);
const keepAlive = synthQuietKeepAlive(1.0);
for (const dir of ['ios/App/App', 'ios/App']) {
  toWav(melody, path.join(root, dir, 'alarm.wav'));
  toWav(keepAlive, path.join(root, dir, 'silence.wav'));
}
