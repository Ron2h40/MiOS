import { MINUTE_MS, toIso, toMs } from "./time";
import type { ISODateTime, Task } from "./types";

/**
 * A2 — the scheduler. The user orders tasks by priority and deadline.
 * Nothing here reorders on its own: sorting helpers return a proposed order
 * that the UI applies only when the user asks.
 */

export type QueueStrategy = "manual" | "priority-deadline";

const deadlineMs = (t: Task): number => (t.deadline ? toMs(t.deadline) : Number.POSITIVE_INFINITY);

/** Priority first (1 is highest), then earliest deadline, then oldest. */
export const compareByPriorityDeadline = (a: Task, b: Task): number =>
  a.priority - b.priority || deadlineMs(a) - deadlineMs(b) || toMs(a.createdAt) - toMs(b.createdAt);

export const compareByManualOrder = (a: Task, b: Task): number =>
  a.order - b.order || toMs(a.createdAt) - toMs(b.createdAt);

export const sortTasks = (tasks: readonly Task[], strategy: QueueStrategy): Task[] =>
  [...tasks].sort(strategy === "manual" ? compareByManualOrder : compareByPriorityDeadline);

/** Ready tasks in the order they would run. */
export const readyQueue = (tasks: readonly Task[], strategy: QueueStrategy = "manual"): Task[] =>
  sortTasks(
    tasks.filter((t) => t.state === "ready"),
    strategy,
  );

/** Next free `order` value, so new tasks join the back of the queue. */
export const nextOrder = (tasks: readonly Task[]): number =>
  tasks.reduce((max, t) => Math.max(max, t.order), 0) + 1;

/**
 * Move one task up or down within a list (a whole queue or one section of it).
 * The task swaps places with its neighbour in that list, and no other task's
 * order changes. Returns only the two changed orders; empty at either end.
 */
export const moveInQueue = (
  queue: readonly Task[],
  taskId: string,
  direction: "up" | "down",
): Map<string, number> => {
  const i = queue.findIndex((t) => t.id === taskId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= queue.length) return new Map();
  const [a, b] = [queue[i], queue[j]];
  return new Map([
    [a.id, b.order],
    [b.id, a.order],
  ]);
};

/** Ready tasks split into the two queue sections: with a deadline, and without. */
export const splitByDeadline = (tasks: readonly Task[]): { timed: Task[]; untimed: Task[] } => ({
  timed: tasks.filter((t) => t.deadline),
  untimed: tasks.filter((t) => !t.deadline),
});

export interface Projection {
  task: Task;
  start: ISODateTime;
  finish: ISODateTime;
  /** True when the projected finish lands after the deadline. */
  late: boolean;
}

/** Minutes of work left on a task, using the user's guess or a default. */
export const remainingMinutes = (task: Task, defaultEstimate: number): number =>
  Math.max((task.estimateMinutes ?? defaultEstimate) - task.actualMinutes, 5);

/**
 * Lay tasks end to end from `now` and project when each would finish.
 * This is a simple single-lane model: good enough to show what an interrupt
 * pushes back, without pretending to be a calendar.
 */
export const projectQueue = (
  queue: readonly Task[],
  now: ISODateTime,
  defaultEstimate: number,
): Projection[] => {
  let cursor = toMs(now);
  return queue.map((task) => {
    const start = cursor;
    cursor += remainingMinutes(task, defaultEstimate) * MINUTE_MS;
    return {
      task,
      start: toIso(start),
      finish: toIso(cursor),
      late: task.deadline ? cursor > toMs(task.deadline) : false,
    };
  });
};
