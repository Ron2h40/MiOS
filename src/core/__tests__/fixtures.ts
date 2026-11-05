import type { Task } from "../types";

export const NOW = "2026-11-05T12:00:00.000Z";

let n = 0;

/** Build a task with sensible defaults; override only what a test cares about. */
export const makeTask = (overrides: Partial<Task> = {}): Task => {
  n++;
  return {
    id: overrides.id ?? `t${n}`,
    title: overrides.title ?? `Task ${n}`,
    mode: "daily-life",
    state: "ready",
    priority: 2,
    order: n,
    blockedBy: [],
    isInterrupt: false,
    actualMinutes: 0,
    createdAt: NOW,
    updatedAt: NOW,
    stateChangedAt: NOW,
    ...overrides,
  };
};

export const taskBlocker = (taskId: string, id = `b-${taskId}`) => ({ id, kind: "task" as const, taskId });
