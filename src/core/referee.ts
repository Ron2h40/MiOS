import { MINUTE_MS, parseClock } from "./time";
import type { ISODateTime, ProtectedBlock, Settings, Task } from "./types";

/**
 * A6 — the referee. Protected time blocks (sleep, gym, …) can't be scheduled
 * into without the user's approval. The running cap lives in `process.ts`.
 *
 * Protected blocks use the user's local clock, so this module reads local
 * time from `Date` on purpose.
 */

export interface ProtectedConflict {
  block: ProtectedBlock;
  start: Date;
  end: Date;
}

const startOfLocalDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Concrete occurrences of a block that could touch the range [from, to). */
export const occurrences = (block: ProtectedBlock, from: Date, to: Date): { start: Date; end: Date }[] => {
  const startMin = parseClock(block.start);
  const endMin = parseClock(block.end);
  const spansMidnight = endMin <= startMin;
  const result: { start: Date; end: Date }[] = [];
  // Start a day early to catch overnight blocks that began yesterday.
  for (let day = addDays(startOfLocalDay(from), -1); day < to; day = addDays(day, 1)) {
    if (block.days.length && !block.days.includes(day.getDay())) continue;
    const start = new Date(day.getTime() + startMin * MINUTE_MS);
    const endDay = spansMidnight ? addDays(day, 1) : day;
    const end = new Date(endDay.getTime() + endMin * MINUTE_MS);
    if (start < to && end > from) result.push({ start, end });
  }
  return result;
};

/** Protected blocks that a planned slot would overlap. */
export const findProtectedConflicts = (
  start: ISODateTime,
  durationMinutes: number,
  blocks: readonly ProtectedBlock[],
): ProtectedConflict[] => {
  const from = new Date(start);
  const to = new Date(from.getTime() + Math.max(durationMinutes, 1) * MINUTE_MS);
  return blocks.flatMap((block) => occurrences(block, from, to).map((o) => ({ block, ...o })));
};

/** Conflicts for a task's planned slot, unless the user already approved it. */
export const taskProtectedConflicts = (
  task: Pick<Task, "scheduledStart" | "estimateMinutes" | "protectedOverride">,
  settings: Pick<Settings, "protectedBlocks" | "defaultEstimateMinutes">,
): ProtectedConflict[] => {
  if (!task.scheduledStart || task.protectedOverride) return [];
  return findProtectedConflicts(
    task.scheduledStart,
    task.estimateMinutes ?? settings.defaultEstimateMinutes,
    settings.protectedBlocks,
  );
};
