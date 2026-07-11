import { registerPlugin } from '@capacitor/core';
import type { AppState } from '../types';
import { MS_DAY, fmtTime, startOfDay } from '../lib/dates';
import { expandEvents, expandTasks } from '../lib/recurrence';

/**
 * Feeds today's (and tomorrow's) items to the iOS home-screen widget via
 * app-group storage. No-op on the web. See ios/Widget/README-WIDGET.md for
 * the one-time widget-target setup in Xcode.
 */

interface WidgetBridge {
  setWidgetData(options: { json: string }): Promise<void>;
}

const AlarmAudio = registerPlugin<WidgetBridge>('AlarmAudio');

function isNative(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

interface WidgetItem {
  type: 'event' | 'task';
  title: string;
  time?: string;
  done?: boolean;
  color: string;
}

let timer: number | null = null;
let lastJson = '';

export function scheduleWidgetUpdate(state: AppState): void {
  if (!isNative()) return;
  if (timer !== null) clearTimeout(timer);
  timer = window.setTimeout(() => void pushWidgetData(state), 800);
}

async function pushWidgetData(state: AppState): Promise<void> {
  const visible = new Set(state.calendars.filter((c) => c.visible).map((c) => c.id));
  const calById = new Map(state.calendars.map((c) => [c.id, c]));
  const dayStart = startOfDay(new Date()).getTime();

  const buildDay = (start: number): WidgetItem[] => {
    const end = start + MS_DAY;
    const items: WidgetItem[] = [];
    for (const occ of expandEvents(state.events, visible, start, end)) {
      const cal = calById.get(occ.event.calendarId);
      items.push({
        type: 'event',
        title: occ.event.title || '(untitled)',
        time: occ.event.allDay ? undefined : fmtTime(occ.start),
        color: occ.event.color ?? cal?.color ?? '#206657',
      });
    }
    for (const occ of expandTasks(state.tasks, visible, start, end)) {
      const cal = calById.get(occ.task.calendarId);
      items.push({
        type: 'task',
        title: occ.task.title || '(untitled)',
        time: occ.task.hasTime ? fmtTime(occ.due) : undefined,
        done: occ.completed,
        color: cal?.color ?? '#206657',
      });
    }
    return items.slice(0, 12);
  };

  const payload = {
    updatedAt: Date.now(),
    today: buildDay(dayStart),
    tomorrow: buildDay(dayStart + MS_DAY),
  };
  const json = JSON.stringify(payload);
  if (json === lastJson) return;
  lastJson = json;
  try {
    await AlarmAudio.setWidgetData({ json });
  } catch {
    // widget/app group not set up yet — harmless
  }
}
