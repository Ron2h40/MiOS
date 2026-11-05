import { daysBetween } from "./time";
import type { ISODateTime, Settings, Task } from "./types";

/**
 * A5 — starvation flag. A task that has sat Blocked or waiting in Ready past
 * the user's threshold gets flagged (e.g. a follow-up waiting 14 days).
 */
export interface StarvationFlag {
  task: Task;
  daysWaiting: number;
}

export const findStarved = (
  tasks: readonly Task[],
  settings: Pick<Settings, "starvationDays">,
  now: ISODateTime,
): StarvationFlag[] =>
  tasks
    .filter((t) => t.state === "blocked" || t.state === "ready")
    .map((task) => ({ task, daysWaiting: Math.floor(daysBetween(task.stateChangedAt, now)) }))
    .filter((f) => f.daysWaiting >= settings.starvationDays)
    .sort((a, b) => b.daysWaiting - a.daysWaiting);
