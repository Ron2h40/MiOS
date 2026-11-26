import { daysBetween } from "./time";
import type { ISODateTime, Settings, Task } from "./types";

/**
 * A5: starvation flag. A task that has sat Blocked or waiting in Ready past
 * the user's threshold gets flagged (e.g. a follow-up waiting 14 days).
 * "Remind me later" hides a flag for a few days.
 */
export interface StarvationFlag {
  task: Task;
  daysWaiting: number;
}

/** How long "Remind me in 3 days" hides a flag. */
export const WAITING_SNOOZE_DAYS = 3;

const snoozed = (t: Task, now: ISODateTime): boolean =>
  !!t.waitingSnoozedUntil && Date.parse(t.waitingSnoozedUntil) > Date.parse(now);

export const findStarved = (
  tasks: readonly Task[],
  settings: Pick<Settings, "starvationDays">,
  now: ISODateTime,
): StarvationFlag[] =>
  tasks
    .filter((t) => (t.state === "blocked" || t.state === "ready") && !snoozed(t, now))
    .map((task) => ({ task, daysWaiting: Math.floor(daysBetween(task.stateChangedAt, now)) }))
    .filter((f) => f.daysWaiting >= settings.starvationDays)
    .sort((a, b) => b.daysWaiting - a.daysWaiting);

/** What a flagged task is waiting on, so the flag can offer the right buttons. */
export type WaitingReason =
  | { kind: "person" | "event"; blockerId: string; label: string }
  | { kind: "task"; blockerId: string; taskId: string; title: string }
  /** Ready, but nobody has touched it. */
  | { kind: "untouched" };

export const waitingReason = (task: Task, tasksById: ReadonlyMap<string, Task>): WaitingReason => {
  if (task.state === "blocked") {
    for (const b of task.blockedBy) {
      if (b.kind === "task") {
        const other = tasksById.get(b.taskId);
        if (other && other.state !== "done") return { kind: "task", blockerId: b.id, taskId: other.id, title: other.title };
      } else if (!b.resolved) {
        return { kind: b.kind, blockerId: b.id, label: b.label };
      }
    }
  }
  return { kind: "untouched" };
};
