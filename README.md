# ADHD Calendar — a calendar that actually rings

A Google Calendar–style web app with one uncompromising idea: **appointments deserve real alarms**, not polite notifications. Every event can have any number of alarms (30 min, 20 min, 10 min — whatever you set), and when one fires, the app takes over the screen and *rings until you stop it*. Snooze if you must.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Everything is stored locally in your browser (localStorage). No backend, no account.

## Features

- **Day / Week / Month views** with drag-to-create, drag-to-move, and drag-to-resize (15-min snapping), overlapping-event layout, a live "now" line, all-day row, and a mini month in the sidebar.
- **Multiple calendars** with colors, show/hide toggles, rename/delete.
- **Recurring events** — daily, weekdays, weekly, monthly, yearly; delete a single occurrence or a whole series.
- **Real alarms** ⏰ — multiple per event, quick chips (5/10/15/20/30/60 min, 1 day) plus custom offsets. A full-screen takeover with a synthesized bell (Web Audio, no audio files) that loops and escalates until dismissed. Snooze 5/10/15 min. Backup system notification when the tab is hidden. Alarms also fire up to 15 min late if the tab was asleep at the trigger moment.
- **Google Calendar, two ways to connect**:
  - **Two-way sync (recommended)** — sign in with Google (one-time ±5 min Client ID setup, guided in the app). Events you create, edit, move, or delete here are pushed to Google Calendar; Google events flow back on every app start and via "Sync now". Changes made offline queue up (localStorage) and flush automatically; a pill in the sidebar shows pending changes. Alarms map to Google reminders and back.
  - **Quick read-only link (1 minute)** — paste a calendar's "Secret address in iCal format"; auto-refreshes on every app start. Great for calendars you only need to see (e.g. a partner's).
- **ICS import** — drop any `.ics` file (exports from Google/Apple/Outlook), including recurring rules and VALARM triggers.
- **Search** across titles, locations and descriptions; **keyboard shortcuts** (`t` today, `d/w/m` views, `←/→` or `j/k` navigate, `c` create, `/` search); light/dark/system **theme**.

## Alarms: how the ringing works

- The alarm engine ticks every 5 s, expands all upcoming occurrences (including recurring ones) for the next 48 h, and computes each event's alarm times (`start − offset`).
- When one is due, the **AlarmOverlay** mounts: pulsing rings, swinging bell, event details, and the bell loop (inharmonic partials synthesized in Web Audio) that grows slowly louder. It does not stop until you press **Stop alarm** — or snooze it.
- Fired alarms are remembered (localStorage) so a reload doesn't re-ring them; snoozes survive reloads too.
- **Browser reality check:** a closed tab cannot ring. Keep the app open (a pinned tab works great) — or use the iOS wrapper below for alarms when the app is closed.

## iOS app (Capacitor)

```bash
npm run build
npx cap add ios      # once — requires Xcode + CocoaPods
npm run ios:sync     # after every web change
npm run ios:open     # opens Xcode; run on your iPhone
```

On iOS, every upcoming alarm is scheduled as a **chain of local notifications** (8 notifications, 30 s apart) so a closed app still nags like an alarm; opening the app and dismissing cancels the rest of the chain. For alarms that bypass the mute switch, request Apple's **critical alerts** entitlement and set `critical: true` on the notifications — see `src/native/alarms.ts`.

Note: the Google "secret address" feed is fetched natively (no CORS) inside the iOS app via CapacitorHttp; in the browser it goes through the Vite dev-server proxy.

## Stack

Vite + React + TypeScript, hand-rolled CSS (no UI framework), Web Audio for the bell, Capacitor for iOS. Fonts: Inter + IBM Plex Mono.
