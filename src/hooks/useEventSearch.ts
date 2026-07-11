import { useMemo } from 'react';
import type { EventItem, Occurrence } from '../types';
import { expandEvent } from '../lib/recurrence';

/** Title/location/description match, upcoming first then most-recent-past */
export function useEventSearch(events: EventItem[], query: string): Occurrence[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const now = Date.now();
    const matching = events.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.location?.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q),
    );
    const horizonStart = now - 180 * 86_400_000;
    const horizonEnd = now + 400 * 86_400_000;
    return matching
      .flatMap((e) => expandEvent(e, horizonStart, horizonEnd))
      .sort((a, b) => {
        const af = a.start >= now ? 0 : 1;
        const bf = b.start >= now ? 0 : 1;
        return af - bf || (af === 0 ? a.start - b.start : b.start - a.start);
      })
      .slice(0, 12);
  }, [events, query]);
}
