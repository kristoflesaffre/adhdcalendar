import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { fmtOffset } from '../lib/dates';
import { ensureAudioUnlocked, testStrike } from '../alarm/sound';
import {
  checkNotificationPermission,
  requestNotificationPermission,
  scheduleTestAlarm,
} from '../native/alarms';
import { armTestRing } from '../native/alarmAudio';
import type { NotificationPermState } from '../native/alarms';
import type { ThemePref } from '../types';
import { BellFilled, Close, GoogleG } from './icons';

function isNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

interface Props {
  onClose: () => void;
  onOpenGoogle: () => void;
}

const DEFAULT_ALARM_CHOICES = [5, 10, 15, 20, 30, 60];

export function SettingsModal({ onClose, onOpenGoogle }: Props) {
  const { state, dispatch } = useStore();
  const { settings } = state;
  const [notifState, setNotifState] = useState(
    'Notification' in window ? Notification.permission : 'unsupported',
  );
  const [nativePerm, setNativePerm] = useState<NotificationPermState>('unsupported');
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => {
    if (isNative()) void checkNotificationPermission().then(setNativePerm);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const toggleDefaultAlarm = (m: number) => {
    const cur = settings.defaultAlarms;
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => b - a);
    dispatch({ type: 'settings/update', patch: { defaultAlarms: next } });
  };

  const askNotifications = async () => {
    if (!('Notification' in window)) return;
    const p = await Notification.requestPermission();
    setNotifState(p);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal-head">
          <h2 className="modal-title">Settings</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Close size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div>
            <span className="field-label">Theme</span>
            <div className="theme-switch" role="group" aria-label="Theme">
              {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
                <button
                  key={t}
                  aria-pressed={settings.theme === t}
                  onClick={() => dispatch({ type: 'settings/update', patch: { theme: t } })}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <h3>
              <BellFilled size={12} /> Alarms
            </h3>
            <p className="settings-hint">
              Default alarms are pre-selected on every new event. Alarms ring in this tab with sound —
              keep the app open (or install the iOS app) for alarms to fire.
            </p>
            <div className="alarm-chips">
              {DEFAULT_ALARM_CHOICES.map((m) => (
                <button
                  key={m}
                  className="chip-btn"
                  aria-pressed={settings.defaultAlarms.includes(m)}
                  onClick={() => toggleDefaultAlarm(m)}
                >
                  {fmtOffset(m)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  ensureAudioUnlocked();
                  testStrike();
                }}
              >
                Test alarm sound
              </button>
              {notifState !== 'unsupported' && notifState !== 'granted' && (
                <button className="btn btn-ghost" onClick={askNotifications}>
                  Enable system notifications
                </button>
              )}
              {notifState === 'granted' && (
                <p className="ok-text" style={{ alignSelf: 'center' }}>
                  System notifications on
                </p>
              )}
            </div>

            {isNative() && (
              <div className="native-alarm-diag">
                <p className="settings-hint" style={{ margin: 0 }}>
                  iOS notifications:{' '}
                  <strong>
                    {nativePerm === 'granted'
                      ? 'allowed'
                      : nativePerm === 'denied'
                        ? 'blocked'
                        : 'not yet asked'}
                  </strong>
                  {nativePerm === 'denied' && ' — open iPhone Settings → ADHD Calendar → Notifications → allow Sounds.'}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {nativePerm !== 'granted' && (
                    <button
                      className="btn btn-ghost"
                      onClick={async () => setNativePerm(await requestNotificationPermission())}
                    >
                      Enable iOS notifications
                    </button>
                  )}
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      await scheduleTestAlarm(15);
                      await armTestRing(15);
                      setTestMsg(
                        'Scheduled — lock your phone now. In 15s the bell starts ringing (even in silent mode) and keeps going until you come back to the app.',
                      );
                    }}
                  >
                    Send test alarm in 15s
                  </button>
                </div>
                {testMsg && <p className="ok-text">{testMsg}</p>}
              </div>
            )}
          </div>

          <div className="settings-section">
            <h3>
              <GoogleG size={13} /> Google Calendar
            </h3>
            <p className="settings-hint">
              Show your Google calendars here. Connecting takes a minute and syncs automatically.
            </p>
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={onOpenGoogle}>
              Connect Google Calendar…
            </button>
          </div>

          <div className="settings-section">
            <h3>Week starts on</h3>
            <div className="theme-switch" role="group">
              <button
                aria-pressed={settings.weekStartsOn === 1}
                onClick={() => dispatch({ type: 'settings/update', patch: { weekStartsOn: 1 } })}
              >
                Monday
              </button>
              <button
                aria-pressed={settings.weekStartsOn === 0}
                onClick={() => dispatch({ type: 'settings/update', patch: { weekStartsOn: 0 } })}
              >
                Sunday
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
