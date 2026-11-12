import "server-only";

import { AI_DAILY_LIMIT } from "@/ai/access";

/**
 * Daily AI allowance per person (signed in) or per network address (guests).
 * Kept in this server's memory: it resets when the server restarts, and each
 * server instance counts on its own. Enough to stop one person using up the
 * shared free tier; a hosted product would move this to a database.
 */

const used = new Map<string, { day: string; count: number }>();

const today = () => new Date().toISOString().slice(0, 10);

/** Count one request. False when today's allowance is already used. */
export const takeAiRequest = (who: string, limit = AI_DAILY_LIMIT): boolean => {
  const day = today();
  const entry = used.get(who);
  const count = entry?.day === day ? entry.count : 0;
  if (count >= limit) return false;
  used.set(who, { day, count: count + 1 });
  // Old days are dropped as people come back; keep the map from growing forever.
  if (used.size > 10_000) for (const [k, v] of used) if (v.day !== day) used.delete(k);
  return true;
};

/** For tests. */
export const resetAiLimits = () => used.clear();
