export type AlarmSoundId =
  | 'alarm'
  | 'tokyo-rain'
  | 'immensity'
  | 'hyper-techno'
  | 'chill-step'
  | 'timelapse';

export interface AlarmSoundOption {
  id: AlarmSoundId;
  label: string;
  fileName: `${AlarmSoundId}.wav`;
  webUrl: string;
}

export const DEFAULT_ALARM_SOUND: AlarmSoundId = 'alarm';

export const ALARM_SOUNDS: readonly AlarmSoundOption[] = [
  {
    id: 'alarm',
    label: 'Classic bell',
    fileName: 'alarm.wav',
    webUrl: new URL('../../ios/App/alarm.wav', import.meta.url).href,
  },
  {
    id: 'tokyo-rain',
    label: 'Tokyo Rain',
    fileName: 'tokyo-rain.wav',
    webUrl: new URL('../../ios/App/tokyo-rain.wav', import.meta.url).href,
  },
  {
    id: 'immensity',
    label: 'Immensity',
    fileName: 'immensity.wav',
    webUrl: new URL('../../ios/App/immensity.wav', import.meta.url).href,
  },
  {
    id: 'hyper-techno',
    label: 'Hyper Techno',
    fileName: 'hyper-techno.wav',
    webUrl: new URL('../../ios/App/hyper-techno.wav', import.meta.url).href,
  },
  {
    id: 'chill-step',
    label: 'Chill Step',
    fileName: 'chill-step.wav',
    webUrl: new URL('../../ios/App/chill-step.wav', import.meta.url).href,
  },
  {
    id: 'timelapse',
    label: 'Timelapse',
    fileName: 'timelapse.wav',
    webUrl: new URL('../../ios/App/timelapse.wav', import.meta.url).href,
  },
];

export function getAlarmSound(id?: string): AlarmSoundOption {
  return ALARM_SOUNDS.find((sound) => sound.id === id) ?? ALARM_SOUNDS[0];
}

export function alarmSoundFileName(id?: string): string {
  return getAlarmSound(id).fileName;
}

export function alarmSoundResource(id?: string): AlarmSoundId {
  return getAlarmSound(id).id;
}
