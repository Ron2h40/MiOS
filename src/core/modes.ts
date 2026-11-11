import { remainingMinutes } from "./scheduler";
import { DAY_MS, toMs } from "./time";
import type { ISODateTime, ModeId, Task, TaskModeId } from "./types";

/**
 * Modes are focused views of one shared OS. To add a mode, add an entry here
 * and to `TaskModeId` in types.ts: nothing else needs to change.
 */
export interface ModeDefinition {
  id: ModeId;
  label: string;
  /** Short line shown under the mode title. */
  blurb: string;
  /** Single glyph used as the mode's icon. */
  icon: string;
}

export const TASK_MODES: readonly (ModeDefinition & { id: TaskModeId })[] = [
  { id: "job-hunt", label: "Job hunt", blurb: "Applications, follow-ups and prep.", icon: "💼" },
  { id: "daily-life", label: "Daily life", blurb: "Errands, health and people.", icon: "☀️" },
  { id: "chores", label: "Chores", blurb: "Home upkeep and repeat jobs.", icon: "🧺" },
];

export const GENERAL_MODE: ModeDefinition = {
  id: "general",
  label: "General",
  blurb: "Everything from every mode in one place.",
  icon: "◎",
};

export const ALL_MODES: readonly ModeDefinition[] = [GENERAL_MODE, ...TASK_MODES];

export const isModeId = (value: string): value is ModeId => ALL_MODES.some((m) => m.id === value);

export const getMode = (id: ModeId): ModeDefinition => ALL_MODES.find((m) => m.id === id) ?? GENERAL_MODE;

/** Tasks visible in a mode. General shows everything. */
export const tasksInMode = (tasks: readonly Task[], mode: ModeId): Task[] =>
  mode === "general" ? [...tasks] : tasks.filter((t) => t.mode === mode);

/**
 * A8: glue. Every mode draws on the same day, so each mode shows what the
 * others are costing. This is the per-mode load summary.
 */
export interface ModeLoad {
  mode: ModeDefinition;
  openTasks: number;
  running: number;
  blocked: number;
  /** Estimated minutes left across Ready and Running tasks. */
  plannedMinutes: number;
  /** Open tasks due within the next 24 hours (or overdue). */
  dueSoon: number;
}

export const modeLoad = (tasks: readonly Task[], now: ISODateTime, defaultEstimate: number): ModeLoad[] => {
  const horizon = toMs(now) + DAY_MS;
  return TASK_MODES.map((mode) => {
    const open = tasks.filter((t) => t.mode === mode.id && t.state !== "done");
    return {
      mode,
      openTasks: open.length,
      running: open.filter((t) => t.state === "running").length,
      blocked: open.filter((t) => t.state === "blocked").length,
      plannedMinutes: open
        .filter((t) => t.state === "ready" || t.state === "running")
        .reduce((sum, t) => sum + remainingMinutes(t, defaultEstimate), 0),
      dueSoon: open.filter((t) => t.deadline && toMs(t.deadline) <= horizon).length,
    };
  });
};
