import type { BusyInterval } from "./calendar";
import { MINUTE_MS, parseClock, toMs } from "./time";
import type { ISODateTime, ProtectedBlock, Settings, Task } from "./types";

/**
 * A6: the referee. Protected time blocks (sleep, gym, …) and busy calendar
 * time (E1/E2: classes, shifts) can't be scheduled into without the user's
 * approval. The running cap lives in `process.ts`.
 *
 * Protected blocks use the user's local clock, so this module reads local
 * time from `Date` on purpose.
 */

export interface ProtectedConflict {
  /** What's in the way, e.g. "Sleep" or a calendar event's title. */
  label: string;
  kind: "protected" | "calendar";
  /** For calendar conflicts: which calendar, by name. */
  calendar?: string;
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

/** Protected blocks and busy calendar time that a planned slot would overlap. */
export const findProtectedConflicts = (
  start: ISODateTime,
  durationMinutes: number,
  blocks: readonly ProtectedBlock[],
  busy: readonly BusyInterval[] = [],
): ProtectedConflict[] => {
  const from = new Date(start);
  const to = new Date(from.getTime() + Math.max(durationMinutes, 1) * MINUTE_MS);
  const protectedHits = blocks.flatMap((block) =>
    occurrences(block, from, to).map((o) => ({ label: block.label, kind: "protected" as const, ...o })),
  );
  const calendarHits = busy
    .filter((b) => toMs(b.start) < to.getTime() && toMs(b.end) > from.getTime())
    .map((b) => ({
      label: b.label,
      kind: "calendar" as const,
      ...(b.calendar ? { calendar: b.calendar } : {}),
      start: new Date(b.start),
      end: new Date(b.end),
    }));
  return [...protectedHits, ...calendarHits];
};

/** Conflicts for a task's planned slot, unless the user already approved it. */
export const taskProtectedConflicts = (
  task: Pick<Task, "scheduledStart" | "estimateMinutes" | "protectedOverride">,
  settings: Pick<Settings, "protectedBlocks" | "defaultEstimateMinutes">,
  busy: readonly BusyInterval[] = [],
): ProtectedConflict[] => {
  if (!task.scheduledStart || task.protectedOverride) return [];
  return findProtectedConflicts(
    task.scheduledStart,
    task.estimateMinutes ?? settings.defaultEstimateMinutes,
    settings.protectedBlocks,
    busy,
  );
};
