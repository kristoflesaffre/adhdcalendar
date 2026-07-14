import { alarmSoundFileName } from '../alarm/sounds';

/**
 * Native alarm bridge for the iOS (Capacitor) wrapper.
 *
 * On the web this is a no-op. Inside the Capacitor shell, every upcoming
 * alarm is scheduled as a *chain* of local notifications (one every 20s,
 * 15 in a row, with the app's real bell sound) so it behaves like a real
 * alarm even when the app is closed: it keeps ringing until you open the
 * app and dismiss it — dismissing cancels the rest of the chain.
 *
 * The selected bundled `.wav` file is what actually plays. Passing the bare
 * string 'default' here makes iOS look for a bundle resource literally named
 * "default" and, finding none, play nothing at all: a real file has to exist
 * and be added to the Xcode target.
 *
 * A fully force-quit app can only ever be revived by this OS-scheduled
 * chain — no app-level trick survives that. For the (far more common)
 * locked-screen / backgrounded-but-not-quit case, see native/alarmAudio.ts,
 * which keeps the app alive with a background audio session and plays the
 * same bell directly, no notification round-trip needed.
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
const CHAIN_LENGTH = 15;
const CHAIN_GAP_MS = 30_000;
const FALLBACK_DELAY_MS = 25_000;
const TEST_ALARM_ID = 999_000_001;

function isNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

/** stable numeric id from a string key + chain index */
function numericId(key: string, i: number): number {
  let h = 2166136261;
  for (let c = 0; c < key.length; c++) {
    h ^= key.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 100_000_000) * 10 + i;
}

function notificationId(key: string): number {
  let h = 2166136261;
  for (let c = 0; c < key.length; c++) {
    h ^= key.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  return 1_100_000_000 + (Math.abs(h) % 900_000_000);
}

export async function syncNativeAlarms(
  pending: PendingLike[],
  soundId?: string,
  standardNotifications: StandardNotificationLike[] = [],
): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;

    // clear previously scheduled, then schedule fresh chains — but leave a
    // pending test alarm alone, or any state change would silently kill it
    const existing = await LocalNotifications.getPending();
    const toCancel = existing.notifications.filter((n) => n.id !== TEST_ALARM_ID);
    if (toCancel.length) {
      await LocalNotifications.cancel({
        notifications: toCancel.map((n) => ({ id: n.id })),
      });
    }

    const sound = alarmSoundFileName(soundId);
    // iOS keeps at most 64 pending local notifications. Reserve 45 slots
    // for the next three persistent alarm chains and the rest for reminders.
    const alarmNotifications = pending.slice(0, 3).flatMap((p) =>
      Array.from({ length: CHAIN_LENGTH }, (_, i) => ({
        id: numericId(p.key, i),
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
        schedule: { at: new Date(p.triggerAt + FALLBACK_DELAY_MS + i * CHAIN_GAP_MS), allowWhileIdle: true },
        sound,
        threadIdentifier: p.key,
        extra: { carillonKind: 'alarm' },
      })),
    );

    const reminderNotifications = standardNotifications.slice(0, 18).map((notification) => ({
      id: notificationId(notification.key),
      title: notification.title,
      body: notification.body,
      schedule: { at: new Date(notification.triggerAt), allowWhileIdle: true },
      sound: 'notification.wav',
      threadIdentifier: notification.key,
      extra: { carillonKind: 'notification' },
    }));

    const notifications = [...reminderNotifications, ...alarmNotifications];

    if (notifications.length) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch {
    // plugin missing (plain web build) — ignore
  }
}

/** Cancel the remaining chain for one alarm key (called on dismiss) */
export async function cancelNativeAlarm(key: string): Promise<void> {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const ids = Array.from({ length: CHAIN_LENGTH }, (_, i) => ({ id: numericId(key, i) }));
    await LocalNotifications.cancel({ notifications: ids });
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
 * sound/behaviour on-device without waiting for a real calendar event. */
export async function scheduleTestAlarm(afterSeconds: number, soundId?: string): Promise<void> {
  if (!isNative()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.schedule({
    notifications: [
      {
        id: TEST_ALARM_ID,
        title: '🔔 Test alarm',
        body: `Scheduled ${afterSeconds}s ago — if you can hear this, alarms work.`,
        // Same fallback delay as real alarms: the native iPhone ring should
        // happen first; this notification only proves the fallback path.
        schedule: { at: new Date(Date.now() + afterSeconds * 1000 + FALLBACK_DELAY_MS) },
        sound: alarmSoundFileName(soundId),
      },
    ],
  });
}
