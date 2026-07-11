import { useEffect, useRef, useState } from 'react';
import type { RingingAlarm } from '../types';
import { fmtStartsIn, fmtTime } from '../lib/dates';
import { AlarmBell } from './sound';
import { cancelNativeAlarm, nativeHapticBuzz } from '../native/alarms';
import { stopNativeAlarm } from '../native/alarmAudio';

interface Props {
  alarms: RingingAlarm[];
  onDismiss: (key: string) => void;
  onSnooze: (key: string, minutes: number) => void;
}

/**
 * The signature moment: a full-screen takeover that rings until you stop it.
 * Shows the frontmost alarm; others queue behind it.
 */
export function AlarmOverlay({ alarms, onDismiss, onSnooze }: Props) {
  const bellRef = useRef<AlarmBell | null>(null);
  const [now, setNow] = useState(Date.now());
  const alarm = alarms[0];

  useEffect(() => {
    if (!alarm) return;
    if (!bellRef.current) bellRef.current = new AlarmBell();
    bellRef.current.start();
    // hand off from the native background ring (if it was playing while
    // backgrounded) to this foreground overlay's own bell, so they don't
    // layer on top of each other
    void stopNativeAlarm();
    void nativeHapticBuzz();
    const vib = window.setInterval(() => {
      navigator.vibrate?.([300, 150, 300]);
      void nativeHapticBuzz();
    }, 2000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(vib);
      clearInterval(clock);
      if (alarms.length <= 1) bellRef.current?.stop();
    };
    // restart per frontmost alarm
  }, [alarm?.key]);

  useEffect(() => {
    if (alarms.length === 0) bellRef.current?.stop();
  }, [alarms.length]);

  if (!alarm) return null;

  const handleDismiss = () => {
    void cancelNativeAlarm(alarm.key);
    void stopNativeAlarm();
    onDismiss(alarm.key);
  };
  const handleSnooze = (min: number) => {
    void cancelNativeAlarm(alarm.key);
    void stopNativeAlarm();
    onSnooze(alarm.key, min);
  };

  return (
    <div className="alarm-overlay" role="alertdialog" aria-modal="true" aria-label="Alarm ringing">
      <div className="alarm-card" style={{ ['--alarm-color' as any]: alarm.color }}>
        <div className="alarm-rings" aria-hidden="true">
          <span />
          <span />
          <span />
          <svg className="alarm-bell-icon" viewBox="0 0 32 32" width="44" height="44">
            <path
              d="M16 4c-1 0-1.8.8-1.8 1.8v.7c-3.6.8-6.2 4-6.2 7.8v5l-1.9 2.8c-.5.7 0 1.6.9 1.6h18c.9 0 1.4-.9.9-1.6L24 19.3v-5c0-3.8-2.6-7-6.2-7.8v-.7C17.8 4.8 17 4 16 4zm-2.7 21.3a2.7 2.7 0 0 0 5.4 0z"
              fill="currentColor"
            />
          </svg>
        </div>

        <p className="alarm-kicker">
          {alarm.snoozed ? 'Snoozed alarm' : 'Alarm'} · {alarm.calendarName}
        </p>
        <h1 className="alarm-title">{alarm.title}</h1>
        <p className="alarm-when">
          <strong>{fmtStartsIn(alarm.occStart, now)}</strong>
          <span> · {fmtTime(alarm.occStart)}</span>
          {alarm.location ? <span> · {alarm.location}</span> : null}
        </p>

        <div className="alarm-actions">
          <div className="alarm-snoozes">
            {[5, 10, 15].map((m) => (
              <button key={m} className="btn btn-ghost alarm-snooze" onClick={() => handleSnooze(m)}>
                Snooze {m}m
              </button>
            ))}
          </div>
          <button className="btn alarm-dismiss" onClick={handleDismiss} autoFocus>
            Stop alarm
          </button>
        </div>

        {alarms.length > 1 && (
          <p className="alarm-queue">+{alarms.length - 1} more alarm{alarms.length > 2 ? 's' : ''} waiting</p>
        )}
      </div>
    </div>
  );
}
