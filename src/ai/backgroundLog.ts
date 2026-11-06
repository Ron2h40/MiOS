/**
 * B8 — background analysis log: when it runs and what it sends.
 *
 * It runs whenever the user does a cognitive action or uses
 * AI, at child and teen stage only. Bursts of actions are grouped into one
 * call so the free AI tier isn't used up.
 */
import type { MiosEvent, Stage, Task } from "@/core";

/** Wait this long after the last action before sending a review… */
export const B8_QUIET_MS = 20_000;
/** …but never hold a burst longer than this. */
export const B8_MAX_WAIT_MS = 90_000;
/** How many past reviews to keep. */
export const B8_LOG_LIMIT = 20;

export const b8Active = (stage: Stage): boolean => stage !== "adult";

/**
 * Cognitive actions: the five decisions (move, sort, priority, interrupt
 * choice, breaking a deadlock), finishing a task, a time guess, adding a
 * blocker, and answering a pop-up. Plus any use of AI.
 */
export const isB8Trigger = (e: MiosEvent): boolean => {
  switch (e.type) {
    case "decision_made":
    case "task_completed":
    case "time_guess":
    case "blocker_added":
    case "ai_used":
    case "ai_suggestion":
      return true;
    case "popup_question":
      return e.outcome === "answered";
    default:
      return false;
  }
};

const FEATURE_WORDS: Record<string, string> = {
  order: "reordered the queue",
  priority: "changed a priority",
  interrupt: "decided how to handle an interrupt",
  deadlock: "broke a deadlock",
  schedule: "planned start times",
};

/** One short line per event, for the model. Task titles help it spot habits. */
export const describeEvent = (e: MiosEvent, tasksById: ReadonlyMap<string, Task>): string => {
  const title = (id: string) => `"${tasksById.get(id)?.title ?? "a deleted task"}"`;
  // The user's local clock time, so the model reads "18:30" as evening.
  const d = new Date(e.at);
  const when = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  switch (e.type) {
    case "decision_made":
      return `${when} ${FEATURE_WORDS[e.feature] ?? `made a ${e.feature} decision`}${e.usedAi ? " with AI" : " without AI"}`;
    case "task_completed":
      return `${when} finished ${title(e.taskId)}${e.onTime === false ? " late" : e.onTime ? " on time" : ""}`;
    case "time_guess":
      return `${when} guessed ${e.minutes} min for ${title(e.taskId)}`;
    case "blocker_added":
      return `${when} marked ${title(e.taskId)} as waiting on a ${e.kind}`;
    case "ai_used":
      return `${when} used AI: ${e.feature}`;
    case "ai_suggestion":
      return `${when} ${e.outcome} the AI ${e.feature} suggestion`;
    case "popup_question":
      return `${when} ${e.outcome} a think-first question (${e.feature})`;
    case "task_created":
      return `${when} added ${title(e.taskId)}${e.isInterrupt ? " as an interrupt" : ""}`;
    case "task_state_changed":
      return `${when} moved ${title(e.taskId)} from ${e.from} to ${e.to}`;
    case "interrupt_previewed":
      return `${when} chose to ${e.decision === "run_first" ? "run an interrupt first" : "queue an interrupt"}`;
    case "deadlock_broken":
      return `${when} broke a loop of ${e.cycleLength} tasks`;
    case "referee_override":
      return `${when} scheduled into protected time`;
    case "stage_changed":
      return `${when} moved from ${e.from} to ${e.to} stage`;
  }
};
