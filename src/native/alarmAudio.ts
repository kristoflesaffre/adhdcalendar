import { registerPlugin } from '@capacitor/core';
import { alarmSoundResource } from '../alarm/sounds';

/**
 * Bridge to the custom AlarmAudioPlugin (ios/App/AlarmAudioPlugin.swift).
 *
 * The plugin keeps a near-silent audio session alive in the background and
 * holds a NATIVE queue of upcoming alarms: at each trigger time it loops the
 * loud bell until stop() — then re-arms itself for the next queued alarm.
 * No JavaScript needs to be awake at ring time or between consecutive
 * alarms, so a locked phone with a suspended webview rings every alarm,
 * through the mute switch, until the user comes back (or a 10-min cap).
 * A no-op everywhere outside the iOS shell.
 */

export interface RingQueueItem {
  at: number;
  key: string;
  title?: string;
  body?: string;
  sound?: string;
}

export interface FallbackNotificationItem {
  id: string;
  kind: 'alarm' | 'reminder';
  at: number;
  title: string;
  body: string;
  /** bundled sound file name, e.g. "alarm.wav" */
  sound: string;
  threadKey: string;
}

interface AlarmAudioPlugin {
  startKeepAlive(): Promise<void>;
  scheduleRing(options: {
    at?: number;
    key?: string;
    title?: string;
    body?: string;
    sound?: string;
    queue?: RingQueueItem[];
  }): Promise<void>;
  cancelRing(): Promise<void>;
  ring(options?: { key?: string; sound?: string }): Promise<void>;
  stop(): Promise<void>;
  syncTimerActivities(options: { timers: TimerActivityLike[] }): Promise<void>;
  syncAlarmNotifications(options: { notifications: FallbackNotificationItem[] }): Promise<void>;
  cancelAlarmChain(options: { key: string }): Promise<void>;
  scheduleTestNotification(options: { afterSeconds: number; sound?: string }): Promise<void>;
}

interface TimerActivityLike {
  id: string;
  label: string;
  endAt: number;
  totalMs: number;
  pausedRemaining?: number;
  hue?: number;
}

export const AlarmAudio = registerPlugin<AlarmAudioPlugin>('AlarmAudio');

export function isNative(): boolean {
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
 * Mirror the upcoming alarms into the plugin's native ring queue (empty
 * array disarms). Cheap to call every engine tick — only talks to native
 * when the queue actually changes. Titles/bodies feed the silent
 * lock-screen banner that appears when each bell starts.
 */
export async function syncNativeRingQueue(
  items: Array<Omit<RingQueueItem, 'sound'>>,
  soundId?: string,
): Promise<void> {
  if (!isNative()) return;
  if (Date.now() < testRingUntil) return; // don't clobber an active test
  const sound = alarmSoundResource(soundId);
  const cacheKey =
    items.length === 0 ? 'off' : JSON.stringify([sound, items.map((i) => [i.at, i.key])]);
  if (cacheKey === lastArmed) return;
  try {
    if (items.length === 0) await AlarmAudio.cancelRing();
    else await AlarmAudio.scheduleRing({ queue: items.map((i) => ({ ...i, sound })) });
    // Only cache a successful native call. A failed audio-session start must
    // be retried by the next engine tick instead of silently staying disarmed.
    lastArmed = cacheKey;
  } catch {
    lastArmed = null;
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
export async function ringNativeAlarm(soundId?: string, alarmKey?: string): Promise<void> {
  if (!isNative()) return;
  try {
    await AlarmAudio.ring({ key: alarmKey, sound: alarmSoundResource(soundId) });
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
      queue: [
        {
          at,
          key: 'carillon-test-alarm',
          title: '🔔 Test alarm',
          body: 'Ringing — open the app to stop',
          sound: alarmSoundResource(soundId),
        },
      ],
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
