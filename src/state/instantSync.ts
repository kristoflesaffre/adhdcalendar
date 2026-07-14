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

async function transactBatches(chunks: any[]): Promise<void> {
  for (let index = 0; index < chunks.length; index += BATCH_SIZE) {
    await db.transact(chunks.slice(index, index + BATCH_SIZE));
  }
}

function upsertChunk(value: Omit<SyncRecord, 'id'>) {
  return db.tx.syncRecords.lookup('syncKey', value.syncKey).update(value);
}

export function hasCloudState(records: SyncRecord[]): boolean {
  return records.some((item) => item.kind === 'meta' && item.localId === META_ID);
}

export async function initializeCloudState(state: AppState, ownerId: string): Promise<void> {
  const chunks = stateRecords(state, ownerId).map(upsertChunk);
  await transactBatches(chunks);
  await db.transact(
    upsertChunk(
      record(ownerId, 'meta', META_ID, {
        version: 1,
        initializedAt: Date.now(),
      }),
    ),
  );
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
