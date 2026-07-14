import { registerPlugin } from '@capacitor/core';
import { alarmSoundResource } from '../alarm/sounds';

/**
 * Bridge to the custom AlarmAudioPlugin (ios/App/AlarmAudioPlugin.swift).
 *
 * The plugin keeps a near-silent audio session alive in the background and
 * holds a NATIVE timer for the next alarm: at trigger time it loops the
 * loud bell until stop() — no JavaScript needs to be awake at ring time,
 * so a locked phone with a suspended webview still rings, through the
 * mute switch, until the user comes back to the app (or a 10-min cap).
 * A no-op everywhere outside the iOS shell.
 */
interface AlarmAudioPlugin {
  startKeepAlive(): Promise<void>;
  scheduleRing(options: { at: number; title?: string; body?: string; sound?: string }): Promise<void>;
  cancelRing(): Promise<void>;
  ring(options?: { sound?: string }): Promise<void>;
  stop(): Promise<void>;
  syncTimerActivities(options: { timers: TimerActivityLike[] }): Promise<void>;
}

interface TimerActivityLike {
  id: string;
  label: string;
  endAt: number;
  totalMs: number;
  pausedRemaining?: number;
  hue?: number;
}

const AlarmAudio = registerPlugin<AlarmAudioPlugin>('AlarmAudio');

function isNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

let keepAliveStarted = false;

/** Idempotent — call whenever there's at least one upcoming alarm */
export async function startBackgroundKeepAlive(): Promise<void> {
  if (!isNative() || keepAliveStarted) return;
  try {
    await AlarmAudio.startKeepAlive();
    keepAliveStarted = true;
  } catch {
    // native plugin unavailable — the notification-chain fallback still works
  }
}

let lastArmed: string | null = null;
let testRingUntil = 0;

/**
 * Point the native timer at the next alarm moment (or disarm with null).
 * Cheap to call every engine tick — only talks to native when the value
 * actually changes. Title/body feed the silent lock-screen banner that
 * appears when the bell starts.
 */
export async function armNativeRing(
  atMs: number | null,
  title?: string,
  body?: string,
  soundId?: string,
): Promise<void> {
  if (!isNative()) return;
  if (Date.now() < testRingUntil) return; // don't clobber an active test
  const sound = alarmSoundResource(soundId);
  const key = atMs === null ? 'off' : `${atMs}|${title ?? ''}|${sound}`;
  if (key === lastArmed) return;
  lastArmed = key;
  try {
    if (atMs === null) await AlarmAudio.cancelRing();
    else await AlarmAudio.scheduleRing({ at: atMs, title, body, sound });
  } catch {
    // ignore — fallback paths still apply
  }
}

let lastActivitySync = '';

/**
 * Mirror the running timers to iOS lock-screen Live Activities. Called on
 * every timers change; the native side reconciles (start/update/end), and
 * the countdown itself renders natively so it ticks with the app asleep.
 */
export async function syncTimerLiveActivities(timers: TimerActivityLike[]): Promise<void> {
  if (!isNative()) return;
  const payload = timers.map((t) => ({
    id: t.id,
    label: t.label,
    endAt: t.endAt,
    totalMs: t.totalMs,
    pausedRemaining: t.pausedRemaining,
    hue: t.hue,
  }));
  const key = JSON.stringify(payload);
  if (key === lastActivitySync) return;
  lastActivitySync = key;
  try {
    await AlarmAudio.syncTimerActivities({ timers: payload });
  } catch {
    // plugin without this method (old build) — ignore
  }
}

/** Ring right now (backup path used when JS happens to be awake) */
export async function ringNativeAlarm(soundId?: string): Promise<void> {
  if (!isNative()) return;
  try {
    await AlarmAudio.ring({ sound: alarmSoundResource(soundId) });
  } catch {
    // ignore
  }
}

/** Stop the bell; the quiet keep-alive continues so future alarms work */
export async function stopNativeAlarm(): Promise<void> {
  if (!isNative()) return;
  try {
    await AlarmAudio.stop();
  } catch {
    // ignore
  }
}

/**
 * Full end-to-end test of the real alarm: arms the native timer for
 * `afterSeconds` from now. Lock the phone; it rings — through silent
 * mode — until you return to the app (which stops it) or the 10-min cap.
 */
export async function armTestRing(afterSeconds: number, soundId?: string): Promise<void> {
  if (!isNative()) return;
  const at = Date.now() + afterSeconds * 1000;
  testRingUntil = at + 60_000; // shield the test from engine re-arming
  try {
    await AlarmAudio.scheduleRing({
      at,
      title: '🔔 Test alarm',
      body: 'Ringing — open the app to stop',
      sound: alarmSoundResource(soundId),
    });
  } catch {
    testRingUntil = 0;
    return;
  }
  lastArmed = null; // force the engine to re-arm the real schedule afterwards
  const onVisible = () => {
    if (!document.hidden) {
      void stopNativeAlarm();
      testRingUntil = 0;
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
  document.addEventListener('visibilitychange', onVisible);
}
