/**
 * Domain types for the MiOS core.
 *
 * Everything in `src/core` is plain TypeScript: no React, no Next.js, no AI.
 * The OS core must work with AI fully turned off,
 * so UI and AI layers depend on this module, never the other way round.
 */

/** ISO-8601 timestamp, e.g. "2026-11-05T14:00:00.000Z". */
export type ISODateTime = string;

/** A1 — every task is in exactly one process state. */
export type ProcessState = "ready" | "running" | "blocked" | "done";

export const PROCESS_STATES: readonly ProcessState[] = ["ready", "running", "blocked", "done"];

/** 1 = highest priority, 4 = lowest. */
export type Priority = 1 | 2 | 3 | 4;

/** Concrete life areas a task can belong to. "general" is a view, not a home for tasks. */
export type TaskModeId = "job-hunt" | "daily-life" | "chores";
export type ModeId = TaskModeId | "general";

/** A4 — what a task can be blocked by. */
export type Blocker =
  | { id: string; kind: "task"; taskId: string }
  | { id: string; kind: "person"; label: string; resolved: boolean }
  | { id: string; kind: "event"; label: string; resolved: boolean };

export interface Task {
  id: string;
  title: string;
  mode: TaskModeId;
  state: ProcessState;
  priority: Priority;
  /** Manual position in the user's queue (lower runs first). */
  order: number;
  deadline?: ISODateTime;
  /** Optional planned start, used by the referee (A6) to check protected time. */
  scheduledStart?: ISODateTime;
  /** User approved scheduling into protected time (A6). */
  protectedOverride?: boolean;
  blockedBy: Blocker[];
  /** The task's order or start time came from an accepted AI suggestion (B1/B2). */
  aiPlanned?: boolean;
  /** A3 — flagged as an incoming interrupt. */
  isInterrupt: boolean;
  /** A9 — user's guess, in minutes, made before starting. */
  estimateMinutes?: number;
  /** A9 — accumulated running time, in minutes. */
  actualMinutes: number;
  /** Set while the task is Running; used to accumulate actual time. */
  runningSince?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** When the task last changed state (used by starvation, A5). */
  stateChangedAt: ISODateTime;
  completedAt?: ISODateTime;
  /** E1/E2 — the calendar item this task was made from, so it's never added twice. */
  source?: { kind: "calendar"; eventKey: string; uid: string };
}

/** A6 — recurring protected time, e.g. sleep or gym. Times are local "HH:MM". */
export interface ProtectedBlock {
  id: string;
  label: string;
  /** 0 = Sunday … 6 = Saturday. Empty means every day. */
  days: number[];
  start: string;
  end: string;
}

/** Assistant stages (Core concepts). */
export type Stage = "child" | "teen" | "adult";
export const STAGES: readonly Stage[] = ["child", "teen", "adult"];

export interface Settings {
  stage: Stage;
  /** A6 — max tasks Running at once, 1 to 3. */
  runningCap: 1 | 2 | 3;
  /** A5 — days before a blocked or waiting task is flagged. */
  starvationDays: number;
  protectedBlocks: ProtectedBlock[];
  /** Default estimate used for projections when a task has none. */
  defaultEstimateMinutes: number;
  /** When the user finished onboarding and saw the AI disclosure. */
  onboardedAt?: ISODateTime;
}
