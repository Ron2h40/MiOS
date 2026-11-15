import type { ISODateTime, ProcessState, Stage, TaskModeId } from "./types";

/**
 * Metrics event log.
 *
 * Metrics are tracked from day one: overrides, pop-up answers vs skips,
 * on-time finishes, stage-ups, streaks and retention.
 * Every user action that feeds the progress gate or a success metric is
 * appended here. Events are never edited or deleted, so all-time stats survive
 * stage changes.
 */
export type MiosEvent =
  | { type: "task_created"; at: ISODateTime; stage: Stage; taskId: string; mode: TaskModeId; isInterrupt: boolean }
  | { type: "task_state_changed"; at: ISODateTime; stage: Stage; taskId: string; from: ProcessState; to: ProcessState }
  | {
      type: "task_completed";
      at: ISODateTime;
      stage: Stage;
      taskId: string;
      /** null when the task had no deadline: its own type, left out of the on-time rate. */
      onTime: boolean | null;
      /** True when the user ordered/scheduled it without AI help. */
      ownChoice: boolean;
    }
  | { type: "decision_made"; at: ISODateTime; stage: Stage; usedAi: boolean; feature: string }
  | { type: "ai_suggestion"; at: ISODateTime; stage: Stage; feature: string; outcome: "accepted" | "overridden" }
  | { type: "popup_question"; at: ISODateTime; stage: Stage; feature: string; outcome: "answered" | "skipped" }
  | { type: "interrupt_previewed"; at: ISODateTime; stage: Stage; taskId: string; decision: "run_first" | "queue" }
  | { type: "deadlock_broken"; at: ISODateTime; stage: Stage; cycleLength: number }
  | { type: "referee_override"; at: ISODateTime; stage: Stage; taskId: string; blockLabel: string }
  | { type: "stage_changed"; at: ISODateTime; stage: Stage; from: Stage; to: Stage; reason: "auto" | "manual" }
  | { type: "time_guess"; at: ISODateTime; stage: Stage; taskId: string; minutes: number }
  | { type: "blocker_added"; at: ISODateTime; stage: Stage; taskId: string; kind: "task" | "person" | "event" }
  | { type: "ai_used"; at: ISODateTime; stage: Stage; feature: string }
  /** An unfinished, untouched day of a repeating task was replaced by the next one. */
  | { type: "repeat_replaced"; at: ISODateTime; stage: Stage; taskId: string; byTaskId: string }
  /** B5–B7: the user did the thinking: wrote a summary, wrote steps, or answered a review. */
  | { type: "own_work"; at: ISODateTime; stage: Stage; taskId: string; kind: "summary" | "steps" | "review" }
  /**
   * Daily medicines. Habits only: never which medicine. `lateMinutes` is null
   * when the dose had no due time; `scheduled` is false for an extra or
   * as-needed dose.
   */
  | { type: "med_logged"; at: ISODateTime; stage: Stage; scheduled: boolean; lateMinutes: number | null }
  | { type: "med_dismissed"; at: ISODateTime; stage: Stage };

export type MiosEventType = MiosEvent["type"];

/** Distributive Omit so each union member keeps its own fields. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** An event before the store stamps it with time and stage. */
export type MiosEventInput = DistributiveOmit<MiosEvent, "at" | "stage">;
