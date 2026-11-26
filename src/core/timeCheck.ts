import type { MiosEvent } from "./events";
import type { Task } from "./types";

/**
 * Checking a finished task's actual time.
 *
 * The actual time counts the whole time a task is Running, so a task left
 * running by mistake shows a long time. After a finish that took this many
 * times the guess or more, MiOS asks whether finish was clicked late.
 * A correction changes only the time taken: on time or late is always judged
 * by when finish was actually clicked.
 */
export const TIME_CHECK_RATIO = 2;

/** How long after finishing the check is still offered. */
export const TIME_CHECK_WINDOW_MS = 10 * 60_000;

/** The most a corrected time can be: 7 days. */
export const MAX_ACTUAL_MINUTES = 7 * 24 * 60;

/** Where a time was checked or corrected. */
export type TimeCheckPlace = "finish_check" | "review" | "history";

/** True when the time was checked after the task's latest finish. */
export const timeChecked = (t: Pick<Task, "timeCheckedAt" | "completedAt">): boolean =>
  !!t.timeCheckedAt && !!t.completedAt && Date.parse(t.timeCheckedAt) >= Date.parse(t.completedAt);

/** A finished task that took at least twice its guess. */
export const tookTooLong = (t: Pick<Task, "estimateMinutes" | "actualMinutes">): boolean =>
  !!t.estimateMinutes && t.estimateMinutes > 0 && t.actualMinutes >= t.estimateMinutes * TIME_CHECK_RATIO;

/**
 * The task waiting for the time check: finished in the last few minutes,
 * took twice its guess or more, and not checked since. Newest first.
 */
export const timeCheckDue = (tasks: readonly Task[], events: readonly MiosEvent[], now: number): Task | undefined => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (now - Date.parse(e.at) > TIME_CHECK_WINDOW_MS) break;
    if (e.type !== "task_completed") continue;
    const t = byId.get(e.taskId);
    if (t && t.state === "done" && tookTooLong(t) && !timeChecked(t)) return t;
  }
  return undefined;
};

/** A typed time, rounded to whole minutes; null when it isn't a usable time. */
export const cleanMinutes = (minutes: number): number | null =>
  Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_ACTUAL_MINUTES ? Math.round(minutes) : null;

/** Hours and minutes from two typed fields; null when neither is a usable time. */
export const minutesFromParts = (hours: string, minutes: string): number | null => {
  const h = hours.trim() === "" ? 0 : Number(hours);
  const m = minutes.trim() === "" ? 0 : Number(minutes);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) return null;
  return cleanMinutes(h * 60 + m);
};

/** Split minutes into whole hours and the minutes left over, for the two fields. */
export const partsFromMinutes = (total: number): { hours: number; minutes: number } => {
  const rounded = Math.max(0, Math.round(total));
  return { hours: Math.floor(rounded / 60), minutes: rounded % 60 };
};
