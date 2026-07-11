import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'be.adhdcalendar.app',
  appName: 'ADHD Calendar',
  webDir: 'dist',
  ios: {
    // 'never': the web layer handles the notch itself via
    // env(safe-area-inset-*); 'automatic' would inset the whole webview a
    // second time, leaving a big dead strip under the status bar
    contentInset: 'never',
  },
  plugins: {
    LocalNotifications: {
      // fallback sound; individual alarms pass the user's selected bundled
      // .wav file so iOS can resolve it as a notification resource
      sound: 'alarm.wav',
    },
  },
};

export default config;
