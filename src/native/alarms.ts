import { alarmSoundFileName } from '../alarm/sounds';
import { AlarmAudio, isNative } from './alarmAudio';
import type { FallbackNotificationItem } from './alarmAudio';

/**
 * Native alarm bridge for the iOS (Capacitor) wrapper.
 *
 * On the web this is a no-op. Inside the Capacitor shell, every upcoming
 * alarm is scheduled as a *chain* of local notifications (one every 30s,
 * up to 15 in a row, with the app's real bell sound) so it behaves like a
 * real alarm even when the app is force-quit: it keeps ringing until you
 * open the app and dismiss it — dismissing cancels the rest of the chain.
 *
 * The chain is scheduled through AlarmAudioPlugin.syncAlarmNotifications
 * rather than the LocalNotifications plugin, so the complete audible chain
 * can be replaced atomically. The Capacitor plugin is still used for the
 * permission prompt.
 *
 * The selected bundled `.wav` file is what actually plays. Passing the bare
 * string 'default' here makes iOS look for a bundle resource literally named
 * "default" and, finding none, play nothing at all: a real file has to exist
 * and be added to the Xcode target.
 *
 * A fully force-quit app can only ever be revived by this OS-scheduled
 * chain — no app-level trick survives that. For the (far more common)
 * locked-screen / backgrounded-but-not-quit case, see native/alarmAudio.ts,
 * which keeps the app alive with a background audio session and rings the
 * whole native alarm queue directly, no notification round-trip needed.
 */

interface PendingLike {
  key: string;
  triggerAt: number;
  base: { title: string; minutesBefore: number; location?: string };
}

export interface StandardNotificationLike {
  key: string;
  triggerAt: number;
  title: string;
  body: string;
}

// each notification plays the full 29s tolling bell; 30s gaps make the
// chain ring near-continuously for ~7.5 minutes even when force-quit
const MAX_CHAIN_LENGTH = 15;
const CHAIN_GAP_MS = 30_000;
const FALLBACK_DELAY_MS = 25_000;
const MAX_PENDING_NOTIFICATIONS = 64;
const RESERVED_TEST_SLOTS = 1;
const MAX_STANDARD_NOTIFICATIONS = 18;

/** stable numeric id from a string key + chain index */
function numericId(key: string, i: number): number {
  let h = 2166136261;
  for (let c = 0; c < key.length; c++) {
    h ^= key.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 20_000_000) * 100 + i;
}

function notificationId(key: string): number {
  let h = 2166136261;
  for (let c = 0; c < key.length; c++) {
    h ^= key.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  return 1_100_000_000 + (Math.abs(h) % 900_000_000);
}

let nativeSyncQueue: Promise<void> = Promise.resolve();

export function syncNativeAlarms(
  pending: PendingLike[],
  soundId?: string,
  standardNotifications: StandardNotificationLike[] = [],
): Promise<void> {
  if (!isNative()) return Promise.resolve();

  // State changes can arrive while the previous cancel/schedule cycle is
  // still running. Serialize snapshots so an older cycle cannot erase the
  // notifications that a newer cycle just installed.
  const pendingSnapshot = pending.map((alarm) => ({ ...alarm, base: { ...alarm.base } }));
  const notificationSnapshot = standardNotifications.map((notification) => ({ ...notification }));
  nativeSyncQueue = nativeSyncQueue
    .catch(() => undefined)
    .then(() => performNativeAlarmSync(pendingSnapshot, soundId, notificationSnapshot));
  return nativeSyncQueue;
}

async function performNativeAlarmSync(
  pending: PendingLike[],
  soundId: string | undefined,
  standardNotifications: StandardNotificationLike[],
): Promise<void> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;

    const reminderNotifications: FallbackNotificationItem[] = standardNotifications
      .slice(0, MAX_STANDARD_NOTIFICATIONS)
      .map((notification) => ({
        id: `carillon-n-${notificationId(notification.key)}`,
        kind: 'reminder',
        at: notification.triggerAt,
        title: notification.title,
        body: notification.body,
        sound: 'notification.wav',
        threadKey: notification.key,
      }));

    const sound = alarmSoundFileName(soundId);
    const alarmCapacity = Math.max(
      0,
      MAX_PENDING_NOTIFICATIONS - RESERVED_TEST_SLOTS - reminderNotifications.length,
    );
    const protectedAlarms = pending.slice(0, alarmCapacity);
    const chainLengths = protectedAlarms.map(() => 1);
    let remainingSlots = alarmCapacity - protectedAlarms.length;
    let chainIndex = 0;
    while (remainingSlots > 0 && chainLengths.length > 0) {
      if (chainLengths[chainIndex] < MAX_CHAIN_LENGTH) {
        chainLengths[chainIndex] += 1;
        remainingSlots -= 1;
      }
      chainIndex = (chainIndex + 1) % chainLengths.length;
      if (chainLengths.every((length) => length === MAX_CHAIN_LENGTH)) break;
    }

    // Every protected alarm gets at least one OS-scheduled audible fallback.
    // Remaining slots are distributed evenly as repeat chains.
    const alarmNotifications: FallbackNotificationItem[] = protectedAlarms.flatMap(
      (p, alarmIndex) =>
        Array.from({ length: chainLengths[alarmIndex] }, (_, i): FallbackNotificationItem => ({
          id: `carillon-a-${numericId(p.key, i)}`,
          kind: 'alarm',
          title: `🔔 ${p.base.title}`,
          body:
            (p.base.minutesBefore === 0
              ? 'Starting now'
              : `Starts in ${p.base.minutesBefore} min`) +
            (p.base.location ? ` · ${p.base.location}` : '') +
            (i > 0 ? '  (still ringing — open to dismiss)' : ''),
          // The notification chain is only a last-resort fallback for a
          // force-quit/killed app. Give the native iPhone audio loop first
          // priority; otherwise iOS may route this notification to Apple Watch
          // as a small ping before the real phone alarm gets heard.
          at: p.triggerAt + FALLBACK_DELAY_MS + i * CHAIN_GAP_MS,
          sound,
          threadKey: p.key,
        })),
    );

    await AlarmAudio.syncAlarmNotifications({
      notifications: [...reminderNotifications, ...alarmNotifications],
    });
  } catch {
    // plugin missing (plain web build) — ignore
  }
}

/** Cancel the remaining chain for one alarm key (called on dismiss) */
export async function cancelNativeAlarm(key: string): Promise<void> {
  if (!isNative()) return;
  try {
    await AlarmAudio.cancelAlarmChain({ key });
  } catch {
    // ignore
  }
}

export async function nativeHapticBuzz(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics } = await import('@capacitor/haptics');
    await Haptics.vibrate({ duration: 400 });
  } catch {
    // ignore
  }
}

export type NotificationPermState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/** read-only permission check for Settings UI — never prompts */
export async function checkNotificationPermission(): Promise<NotificationPermState> {
  if (!isNative()) return 'unsupported';
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    return perm.display as NotificationPermState;
  } catch {
    return 'unsupported';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermState> {
  if (!isNative()) return 'unsupported';
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    return perm.display as NotificationPermState;
  } catch {
    return 'unsupported';
  }
}

/** Schedules one real notification a few seconds out — lets you verify
 * sound/behaviour on-device without waiting for a real calendar event.
 * The native side applies the same fallback delay as real alarms: the
 * native iPhone ring should happen first; this only proves the fallback. */
export async function scheduleTestAlarm(afterSeconds: number, soundId?: string): Promise<void> {
  if (!isNative()) return;
  try {
    await AlarmAudio.scheduleTestNotification({
      afterSeconds,
      sound: alarmSoundFileName(soundId),
    });
  } catch {
    // ignore
  }
}
