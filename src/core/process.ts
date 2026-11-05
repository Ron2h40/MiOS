import { err, ok, type Result } from "./result";
import { minutesBetween } from "./time";
import type { ISODateTime, ProcessState, Settings, Task } from "./types";

/**
 * A1 — process states and the moves allowed between them.
 *
 *   ready ⇄ running → done
 *     ↘     ↓        ↙ (reopen)
 *       blocked → ready
 */
const ALLOWED: Record<ProcessState, readonly ProcessState[]> = {
  ready: ["running", "blocked", "done"],
  running: ["ready", "blocked", "done"],
  blocked: ["ready", "done"],
  done: ["ready"],
};

export const canTransition = (from: ProcessState, to: ProcessState): boolean =>
  ALLOWED[from].includes(to);

/** True when any blocker is still active. A task blocker clears once that task is Done. */
export const hasActiveBlockers = (task: Task, tasksById: ReadonlyMap<string, Task>): boolean =>
  task.blockedBy.some((b) => {
    if (b.kind === "task") {
      const other = tasksById.get(b.taskId);
      return other !== undefined && other.state !== "done";
    }
    return !b.resolved;
  });

/**
 * Move a task to a new state. Leaving Running adds the elapsed time to
 * `actualMinutes`, which feeds time-guess training (A9).
 */
export const transition = (task: Task, to: ProcessState, now: ISODateTime): Result<Task> => {
  if (task.state === to) return ok(task);
  if (!canTransition(task.state, to)) {
    return err(`Can't move a ${task.state} task to ${to}.`);
  }

  let actualMinutes = task.actualMinutes;
  if (task.state === "running" && task.runningSince) {
    actualMinutes += minutesBetween(task.runningSince, now);
  }

  return ok({
    ...task,
    state: to,
    actualMinutes,
    runningSince: to === "running" ? now : undefined,
    completedAt: to === "done" ? now : undefined,
    stateChangedAt: now,
    updatedAt: now,
  });
};

/** A6 — the referee's cap on how many tasks may run at once. */
export const runningCount = (tasks: readonly Task[]): number =>
  tasks.filter((t) => t.state === "running").length;

/** Start a task, enforcing the running cap and active blockers. */
export const startTask = (
  task: Task,
  tasks: readonly Task[],
  settings: Pick<Settings, "runningCap">,
  now: ISODateTime,
): Result<Task> => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (hasActiveBlockers(task, byId)) {
    return err("This task is still blocked. Clear its blockers first.");
  }
  const running = runningCount(tasks.filter((t) => t.id !== task.id));
  if (running >= settings.runningCap) {
    return err(
      `You already have ${running} task${running === 1 ? "" : "s"} running (cap ${settings.runningCap}). Pause or finish one first.`,
    );
  }
  return transition(task, "running", now);
};

/** Was a finished task done by its deadline? null when it had none. */
export const finishedOnTime = (task: Task): boolean | null => {
  if (!task.deadline || !task.completedAt) return null;
  return new Date(task.completedAt).getTime() <= new Date(task.deadline).getTime();
};
