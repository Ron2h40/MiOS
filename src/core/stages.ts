import type { MiosEvent } from "./events";
import { daysBetween } from "./time";
import type { ISODateTime, Stage } from "./types";

/**
 * Assistant stages and the progress gate (auto stage-up).
 *
 * This is the ONE place that defines what each stage allows. Every AI feature
 * reads the current stage from settings and asks these helpers what to do,
 * so stage rules never get scattered across the UI.
 */

export interface StagePolicy {
  label: string;
  /** AI helps without being asked. */
  aiActive: boolean;
  /** An "AI help" button is shown. */
  aiButton: boolean;
  /** The button asks a quick think-first question before helping. */
  popupFirst: boolean;
  description: string;
}

export const STAGE_POLICY: Record<Stage, StagePolicy> = {
  child: {
    label: "Child",
    aiActive: true,
    aiButton: true,
    popupFirst: false,
    description: "AI helps actively. It suggests, estimates and warns. It never decides for you.",
  },
  teen: {
    label: "Teen",
    aiActive: false,
    aiButton: true,
    popupFirst: true,
    description: "Manual by default. The AI help button asks you a quick question first.",
  },
  adult: {
    label: "Adult",
    aiActive: false,
    aiButton: false,
    popupFirst: false,
    description: "Fully manual. The hard-coded tools stay. Switch back to teen if you want AI.",
  },
};

export const nextStage = (stage: Stage): Stage | null =>
  stage === "child" ? "teen" : stage === "teen" ? "adult" : null;

// ---------------------------------------------------------------------------
// Progress gate
// ---------------------------------------------------------------------------

/**
 * Thresholds are first estimates, kept as data so they can be
 * tuned with beta data without touching the evaluation code.
 */
export interface GateThresholds {
  tasksDone: number;
  /** child → teen only: share of AI suggestions the user overrode. */
  minOverrideRate?: number;
  /** teen → adult only: share of decisions made without the AI button. */
  minNoAiDecisionRate?: number;
  /** teen → adult only: share of pop-up questions answered, not skipped. */
  minPopupAnswerRate?: number;
  minOnTimeRate: number;
  minDays: number;
}

export const GATES: Record<"child" | "teen", GateThresholds> = {
  child: { tasksDone: 15, minOverrideRate: 0.2, minOnTimeRate: 0.6, minDays: 7 },
  teen: { tasksDone: 60, minNoAiDecisionRate: 0.7, minPopupAnswerRate: 0.6, minOnTimeRate: 0.75, minDays: 21 },
};

export type SignalUnit = "count" | "rate" | "days";

export interface GateSignal {
  id: string;
  label: string;
  unit: SignalUnit;
  /** null when there is no data yet (e.g. no AI suggestions seen). */
  current: number | null;
  target: number;
  /** Size of the sample behind a rate, so the UI can say "3 of 5". */
  sample?: { hits: number; total: number };
  pass: boolean;
}

export interface GateResult {
  from: Stage;
  to: Stage | null;
  signals: GateSignal[];
  /** Every signal passes: the user moves up automatically. */
  ready: boolean;
}

/**
 * When did the user enter their current stage? Stage-back rule: progress for
 * a stage starts fresh each time the user enters it, so only events after
 * this moment count toward the next gate.
 */
export const stageEnteredAt = (events: readonly MiosEvent[], stage: Stage, fallback: ISODateTime): ISODateTime => {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "stage_changed" && e.to === stage) return e.at;
  }
  return fallback;
};

const rate = (hits: number, total: number) => (total ? hits / total : null);

const rateSignal = (id: string, label: string, hits: number, total: number, target: number): GateSignal => {
  const current = rate(hits, total);
  return { id, label, unit: "rate", current, target, sample: { hits, total }, pass: current !== null && current >= target };
};

/**
 * Evaluate the gate out of the current stage. Only events logged at the
 * current stage, since the user last entered it, count.
 */
export const evaluateGate = (
  events: readonly MiosEvent[],
  stage: Stage,
  enteredAt: ISODateTime,
  now: ISODateTime,
): GateResult => {
  const to = nextStage(stage);
  if (stage === "adult" || !to) return { from: stage, to: null, signals: [], ready: false };

  const g = GATES[stage];
  const window = events.filter((e) => e.stage === stage && e.at >= enteredAt);
  const signals: GateSignal[] = [];

  const completed = window.filter((e) => e.type === "task_completed");
  signals.push({
    id: "tasksDone",
    label: `Tasks done at ${STAGE_POLICY[stage].label.toLowerCase()} stage`,
    unit: "count",
    current: completed.length,
    target: g.tasksDone,
    pass: completed.length >= g.tasksDone,
  });

  if (g.minOverrideRate !== undefined) {
    const s = window.filter((e) => e.type === "ai_suggestion");
    const overridden = s.filter((e) => e.outcome === "overridden").length;
    signals.push(rateSignal("overrideRate", "AI suggestions you overrode", overridden, s.length, g.minOverrideRate));
  }

  if (g.minNoAiDecisionRate !== undefined) {
    const d = window.filter((e) => e.type === "decision_made");
    const own = d.filter((e) => !e.usedAi).length;
    signals.push(rateSignal("noAiDecisions", "Decisions made without the AI button", own, d.length, g.minNoAiDecisionRate));
  }

  if (g.minPopupAnswerRate !== undefined) {
    const p = window.filter((e) => e.type === "popup_question");
    const answered = p.filter((e) => e.outcome === "answered").length;
    signals.push(rateSignal("popupAnswers", "Pop-up questions answered", answered, p.length, g.minPopupAnswerRate));
  }

  // Own choices that had a deadline. Tasks without a deadline can't be on or
  // off time, so they don't count either way.
  const own = completed.filter((e) => e.ownChoice && e.onTime !== null);
  const onTime = own.filter((e) => e.onTime).length;
  signals.push(rateSignal("onTime", "Your own choices finished on time", onTime, own.length, g.minOnTimeRate));

  const days = Math.max(0, daysBetween(enteredAt, now));
  signals.push({
    id: "days",
    label: `Days at ${STAGE_POLICY[stage].label.toLowerCase()} stage`,
    unit: "days",
    current: Math.floor(days),
    target: g.minDays,
    pass: days >= g.minDays,
  });

  return { from: stage, to, signals, ready: signals.every((s) => s.pass) };
};
