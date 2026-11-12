import type { MiosEvent } from "./events";
import { dayKey } from "./rewards";
import type { Task, TaskReview } from "./types";

/**
 * Section B, P1 (B5–B7): the rules around research, breakdown and review.
 * The AI parts live in `src/ai`; these work without it.
 */

/** A task is big when it's guessed or took an hour or more, or has steps. */
export const BIG_TASK_MINUTES = 60;

export const isBigTask = (t: Pick<Task, "estimateMinutes" | "actualMinutes" | "steps">): boolean =>
  (t.estimateMinutes ?? 0) >= BIG_TASK_MINUTES || t.actualMinutes >= BIG_TASK_MINUTES || (t.steps?.length ?? 0) > 0;

/** Research uses Google Search, which has a small free allowance, so it's capped per day. */
export const RESEARCH_PER_DAY = 10;

export const researchUsedToday = (events: readonly MiosEvent[], now: number): number => {
  const today = dayKey(now);
  return events.filter((e) => e.type === "ai_used" && e.feature === "B5" && dayKey(Date.parse(e.at)) === today).length;
};

export const stepsProgress = (t: Pick<Task, "steps">): { done: number; total: number } => ({
  done: t.steps?.filter((s) => s.done).length ?? 0,
  total: t.steps?.length ?? 0,
});

/** Cleans a list of step titles: trimmed, no blanks, no repeats, at most 20. */
export const cleanSteps = (titles: readonly string[]): string[] => {
  const seen = new Set<string>();
  return titles
    .map((t) => t.replace(/\s+/g, " ").trim().slice(0, 200))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 20);
};

/** Plain review questions, used at adult stage and whenever AI isn't available. */
export const REVIEW_QUESTIONS = [
  "What went the way you planned?",
  "What took longer than you expected, and why?",
  "What would you do differently next time?",
  "What helped you keep going?",
  "Was your time guess close? What would you guess now?",
  "What did you learn that you can use again?",
] as const;

/** Three fixed questions, rotating so back-to-back reviews ask different ones. */
export const fixedReviewQuestions = (reviewsSoFar: number): string[] =>
  [0, 1, 2].map((i) => REVIEW_QUESTIONS[(reviewsSoFar * 3 + i) % REVIEW_QUESTIONS.length]);

/** How long after finishing a big task the review is still offered. */
export const REVIEW_WINDOW_MS = 10 * 60_000;

/**
 * The big task waiting for its review: finished in the last few minutes,
 * never reviewed or skipped. Newest first.
 */
export const reviewDue = (tasks: readonly Task[], events: readonly MiosEvent[], now: number): Task | undefined => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (now - Date.parse(e.at) > REVIEW_WINDOW_MS) break;
    if (e.type !== "task_completed") continue;
    const t = byId.get(e.taskId);
    if (t && t.state === "done" && !t.review && isBigTask(t)) return t;
  }
  return undefined;
};

/** A review counts as the user's own work when at least one answer was written. */
export const reviewAnswered = (r: Pick<TaskReview, "answers" | "skipped">): boolean =>
  !r.skipped && r.answers.some((a) => a.answer.trim());
