import type { EventItem } from '../types';
import {
  AuthError,
  gDeleteEvent,
  gInsertEvent,
  gPatchEvent,
  getAccessToken,
  toGoogleResource,
} from './google';

/**
 * Push queue for two-way sync: every local create/edit/move/delete of an
 * event in a Google-connected calendar becomes a queued operation, flushed
 * to the Calendar API. The queue lives in localStorage so nothing is lost
 * offline — it flushes on the next start or the next change.
 */

const QUEUE_KEY = 'carillon.gsync.v1';

export interface SyncOp {
  kind: 'upsert' | 'delete';
  localEventId: string;
  googleCalendarId: string;
  /** known Google id at enqueue time (upserts without one become inserts) */
  googleEventId?: string;
  /** event snapshot for upserts */
  resource?: any;
  queuedAt: number;
}

export type SyncPhase = 'idle' | 'syncing' | 'signin-needed' | 'offline';

interface SyncStatus {
  pending: number;
  phase: SyncPhase;
}

let queue: SyncOp[] = loadQueue();
let phase: SyncPhase = 'idle';
const listeners = new Set<(s: SyncStatus) => void>();

function loadQueue(): SyncOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as SyncOp[]) : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

function notify(): void {
  const s: SyncStatus = { pending: queue.length, phase };
  for (const fn of listeners) fn(s);
}

export function subscribeSync(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  fn({ pending: queue.length, phase });
  return () => listeners.delete(fn);
}

export function getSyncStatus(): SyncStatus {
  return { pending: queue.length, phase };
}

/** Queue a create/update for an event in a Google-connected calendar */
export function queueUpsert(ev: EventItem, googleCalendarId: string): void {
  queue = queue.filter(
    (op) => !(op.localEventId === ev.id && op.kind === 'upsert'),
  );
  queue.push({
    kind: 'upsert',
    localEventId: ev.id,
    googleCalendarId,
    googleEventId: ev.googleEventId,
    resource: toGoogleResource(ev),
    queuedAt: Date.now(),
  });
  persist();
  notify();
}

/** Queue a delete; drops the whole thread if the event never reached Google */
export function queueDelete(ev: EventItem, googleCalendarId: string): void {
  const hadPendingInsert = queue.some(
    (op) => op.localEventId === ev.id && op.kind === 'upsert' && !op.googleEventId,
  );
  queue = queue.filter((op) => op.localEventId !== ev.id);
  if (!hadPendingInsert || ev.googleEventId) {
    if (ev.googleEventId) {
      queue.push({
        kind: 'delete',
        localEventId: ev.id,
        googleCalendarId,
        googleEventId: ev.googleEventId,
        queuedAt: Date.now(),
      });
    }
  }
  persist();
  notify();
}

let flushTimer: number | null = null;
let flushing = false;

/** Debounced flush — call after enqueueing */
export function scheduleFlush(clientId: string, onSynced: OnSynced): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flushQueue(clientId, onSynced), 1200);
}

type OnSynced = (localEventId: string, googleEventId: string) => void;

/**
 * Push all pending operations. Returns the number left in the queue
 * (0 = fully synced). Sets phase to 'signin-needed' when Google wants
 * an interactive sign-in.
 */
export async function flushQueue(clientId: string, onSynced: OnSynced): Promise<number> {
  if (flushing || queue.length === 0 || !clientId) return queue.length;
  flushing = true;
  phase = 'syncing';
  notify();

  try {
    const token = await getAccessToken(clientId);
    if (!token) {
      phase = 'signin-needed';
      return queue.length;
    }
    phase = 'syncing';
    notify();

    // freshly-inserted ids within this run, so follow-up ops resolve
    const newIds = new Map<string, string>();

    while (queue.length) {
      const op = queue[0];
      const gid = op.googleEventId ?? newIds.get(op.localEventId);
      try {
        if (op.kind === 'delete') {
          if (gid) await gDeleteEvent(token, op.googleCalendarId, gid);
        } else if (gid) {
          await gPatchEvent(token, op.googleCalendarId, gid, op.resource);
        } else {
          const created = await gInsertEvent(token, op.googleCalendarId, op.resource);
          newIds.set(op.localEventId, created);
          onSynced(op.localEventId, created);
        }
      } catch (e) {
        if (e instanceof AuthError) {
          phase = 'signin-needed';
          return queue.length;
        }
        if ((e as any)?.status >= 400 && (e as any)?.status < 500) {
          // permanently rejected (bad payload, no permission) — drop it
          // rather than blocking the queue forever
          queue.shift();
          persist();
          continue;
        }
        // network / 5xx — keep queue, retry later
        phase = 'offline';
        return queue.length;
      }
      queue.shift();
      persist();
    }
    phase = 'idle';
    return 0;
  } finally {
    flushing = false;
    notify();
  }
}
