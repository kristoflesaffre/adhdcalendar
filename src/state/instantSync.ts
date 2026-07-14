import type { AppState } from '../types';
import { db } from '../lib/instant';

export type SyncRecordKind =
  | 'calendar'
  | 'event'
  | 'task'
  | 'alarmClock'
  | 'timer'
  | 'settings'
  | 'meta';

export interface SyncRecord {
  id: string;
  syncKey: string;
  ownerId: string;
  kind: SyncRecordKind;
  localId: string;
  position: number;
  payload: unknown;
  updatedAt: number;
}

const META_ID = 'cloud-v1';
const BATCH_SIZE = 100;
const MAX_TRANSACTION_ATTEMPTS = 4;

function cleanPayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload)) as T;
}

function syncKey(ownerId: string, kind: SyncRecordKind, localId: string): string {
  return `${ownerId}:${kind}:${localId}`;
}

function record(
  ownerId: string,
  kind: SyncRecordKind,
  localId: string,
  payload: unknown,
  position = 0,
): Omit<SyncRecord, 'id'> {
  return {
    syncKey: syncKey(ownerId, kind, localId),
    ownerId,
    kind,
    localId,
    position,
    payload: cleanPayload(payload),
    updatedAt: Date.now(),
  };
}

function stateRecords(state: AppState, ownerId: string): Omit<SyncRecord, 'id'>[] {
  return [
    ...state.calendars.map((item, index) => record(ownerId, 'calendar', item.id, item, index)),
    ...state.events.map((item, index) => record(ownerId, 'event', item.id, item, index)),
    ...state.tasks.map((item, index) => record(ownerId, 'task', item.id, item, index)),
    ...state.alarmClocks.map((item, index) => record(ownerId, 'alarmClock', item.id, item, index)),
    ...state.timers.map((item, index) => record(ownerId, 'timer', item.id, item, index)),
    record(ownerId, 'settings', 'settings', state.settings),
  ];
}

function payloadSignature(value: unknown): string {
  return JSON.stringify(cleanPayload(value));
}

function transactionMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'body' in error) {
    const body = (error as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
  }
  return error instanceof Error ? error.message : '';
}

async function transactWithRetry(chunks: any[]): Promise<void> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      await db.transact(chunks);
      return;
    } catch (error) {
      const isDeadlock = transactionMessage(error).toLowerCase().includes('deadlock');
      if (!isDeadlock || attempt === MAX_TRANSACTION_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 80 * attempt + Math.random() * 120));
    }
  }
}

async function transactBatches(chunks: any[]): Promise<void> {
  for (let index = 0; index < chunks.length; index += BATCH_SIZE) {
    await transactWithRetry(chunks.slice(index, index + BATCH_SIZE));
  }
}

function upsertChunk(value: Omit<SyncRecord, 'id'>) {
  const { syncKey: key, ...attributes } = value;
  return db.tx.syncRecords.lookup('syncKey', key).update(attributes);
}

export function hasCloudState(records: SyncRecord[]): boolean {
  return records.some((item) => item.kind === 'meta' && item.localId === META_ID);
}

export async function initializeCloudState(state: AppState, ownerId: string): Promise<void> {
  const chunks = stateRecords(state, ownerId).map(upsertChunk);
  await transactBatches(chunks);
  await transactWithRetry([
    upsertChunk(
      record(ownerId, 'meta', META_ID, {
        version: 1,
        initializedAt: Date.now(),
      }),
    ),
  ]);
}

export function appStateFromRecords(records: SyncRecord[], fallback: AppState): AppState {
  const byKind = <T,>(kind: SyncRecordKind): T[] =>
    records
      .filter((item) => item.kind === kind)
      .sort((a, b) => a.position - b.position || a.localId.localeCompare(b.localId))
      .map((item) => cleanPayload(item.payload) as T);
  const settings = byKind<AppState['settings']>('settings')[0] ?? fallback.settings;

  return {
    calendars: byKind<AppState['calendars'][number]>('calendar'),
    events: byKind<AppState['events'][number]>('event'),
    tasks: byKind<AppState['tasks'][number]>('task'),
    alarmClocks: byKind<AppState['alarmClocks'][number]>('alarmClock'),
    timers: byKind<AppState['timers'][number]>('timer'),
    settings,
  };
}

function calendarIdentity(calendar: AppState['calendars'][number]): string {
  if (calendar.googleId) return `google:${calendar.googleId}`;
  if (calendar.icsUrl) return `ics:${calendar.icsUrl}`;
  return `local:${calendar.id}`;
}

/**
 * Preserve data from an existing pre-sync installation when it first joins an
 * account that already has cloud data. Cloud records win conflicts; local-only
 * records are appended and calendar references are remapped when needed.
 */
export function mergeUnsyncedLocalState(cloud: AppState, local: AppState): AppState {
  const calendars = [...cloud.calendars];
  const cloudCalendarByIdentity = new Map(
    cloud.calendars.map((calendar) => [calendarIdentity(calendar), calendar]),
  );
  const calendarIdMap = new Map<string, string>();

  for (const calendar of local.calendars) {
    const existing = cloudCalendarByIdentity.get(calendarIdentity(calendar));
    if (existing) {
      calendarIdMap.set(calendar.id, existing.id);
      continue;
    }
    calendarIdMap.set(calendar.id, calendar.id);
    calendars.push(calendar);
    cloudCalendarByIdentity.set(calendarIdentity(calendar), calendar);
  }

  const remapCalendar = <T extends { calendarId: string }>(item: T): T => ({
    ...item,
    calendarId: calendarIdMap.get(item.calendarId) ?? item.calendarId,
  });
  const events = [...cloud.events];
  const eventKeys = new Set(
    cloud.events.map((event) =>
      event.googleEventId
        ? `google:${event.calendarId}:${event.googleEventId}`
        : `local:${event.id}`,
    ),
  );
  for (const sourceEvent of local.events) {
    const event = remapCalendar(sourceEvent);
    const key = event.googleEventId
      ? `google:${event.calendarId}:${event.googleEventId}`
      : `local:${event.id}`;
    if (eventKeys.has(key)) continue;
    events.push(event);
    eventKeys.add(key);
  }

  const tasks = [...cloud.tasks];
  const taskIds = new Set(cloud.tasks.map((task) => task.id));
  for (const sourceTask of local.tasks) {
    const task = remapCalendar(sourceTask);
    if (taskIds.has(task.id)) continue;
    tasks.push(task);
    taskIds.add(task.id);
  }

  const appendUnique = <T extends { id: string }>(cloudItems: T[], localItems: T[]): T[] => {
    const result = [...cloudItems];
    const ids = new Set(cloudItems.map((item) => item.id));
    for (const item of localItems) {
      if (ids.has(item.id)) continue;
      result.push(item);
      ids.add(item.id);
    }
    return result;
  };

  return {
    calendars,
    events,
    tasks,
    alarmClocks: appendUnique(cloud.alarmClocks, local.alarmClocks),
    timers: appendUnique(cloud.timers, local.timers),
    settings: cloud.settings,
  };
}

async function syncStateDiff(previous: AppState, next: AppState, ownerId: string): Promise<void> {
  const before = new Map(
    stateRecords(previous, ownerId).map((item) => [item.syncKey, item]),
  );
  const after = new Map(stateRecords(next, ownerId).map((item) => [item.syncKey, item]));
  const chunks: any[] = [];

  for (const [key, value] of after) {
    const old = before.get(key);
    if (
      !old ||
      old.position !== value.position ||
      payloadSignature(old.payload) !== payloadSignature(value.payload)
    ) {
      chunks.push(upsertChunk(value));
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) chunks.push(db.tx.syncRecords.lookup('syncKey', key).delete());
  }

  await transactBatches(chunks);
}

let syncQueue: Promise<void> = Promise.resolve();

export function queueCloudStateDiff(
  previous: AppState,
  next: AppState,
  ownerId: string,
  onSynced: () => void,
  onError: (error: unknown) => void,
): void {
  syncQueue = syncQueue
    .then(() => syncStateDiff(previous, next, ownerId))
    .then(onSynced)
    .catch((error) => {
      onError(error);
    });
}
