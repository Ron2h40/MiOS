/**
 * Shared types for the AI assistant.
 *
 * Used by both the browser and the server route, so this file holds types and
 * plain data only. The OS core in `src/core` never imports from here: MiOS
 * must keep working with AI turned off.
 */
import type { ISODateTime, Priority, ProcessState, ProtectedBlock, Stage, TaskModeId } from "@/core";

/** The P0 AI features. Each one follows the stage rules in `STAGE_POLICY`. */
export type AiFeature = "priority" | "schedule" | "interrupt" | "estimate";

export const AI_FEATURES: Record<AiFeature, { code: string; label: string; skill: string }> = {
  priority: { code: "B1", label: "Priority help", skill: "deciding what to do first when several things compete" },
  schedule: { code: "B2", label: "Scheduling help", skill: "laying tasks out in time around fixed commitments" },
  interrupt: { code: "B3", label: "Interrupt warning", skill: "judging what an unexpected request would push back" },
  estimate: { code: "B4", label: "Task load estimate", skill: "guessing how long and how hard a task will be" },
};

// ---------------------------------------------------------------------------
// Context sent to the model (kept small to save tokens)
// ---------------------------------------------------------------------------

export interface AiTask {
  id: string;
  title: string;
  mode: TaskModeId;
  state: ProcessState;
  priority: Priority;
  deadline?: ISODateTime;
  estimateMinutes?: number;
  actualMinutes: number;
  scheduledStart?: ISODateTime;
  blocked: boolean;
}

export interface AiContext {
  stage: Stage;
  /** The user's local time, so the model reasons about "today" correctly. */
  now: ISODateTime;
  timeZone: string;
  /** Latest notes from the background analysis log (B8). */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Requests and responses, one pair per kind
// ---------------------------------------------------------------------------

export interface PriorityRequest {
  tasks: AiTask[];
}
export interface PriorityResult {
  order: string[];
  reasons: { taskId: string; why: string }[];
  why: string;
}

export interface ScheduleRequest {
  tasks: AiTask[];
  protectedBlocks: ProtectedBlock[];
  defaultEstimateMinutes: number;
}
export interface ScheduleResult {
  /** Local "HH:MM" start times for today. The client checks them against protected time. */
  slots: { taskId: string; start: string }[];
  why: string;
}

export interface InterruptRequest {
  interrupt: AiTask;
  interruptMinutes: number;
  pushedBack: { title: string; delayMinutes: number; newlyLate: boolean; deadline?: ISODateTime }[];
}
export interface InterruptResult {
  severity: "none" | "low" | "high";
  warning: string;
  why: string;
}

export interface EstimateRequest {
  task: AiTask;
  /** Past finished tasks with a guess and actual time, newest last. */
  history: { title: string; estimate: number; actual: number }[];
}
export interface EstimateResult {
  minutes: number;
  effort: "low" | "medium" | "high";
  why: string;
}

/** B8: background analysis of recent activity. */
export interface AnalyzeRequest {
  triggers: string[];
  recentEvents: string[];
  tasks: AiTask[];
  previousSummary: string;
}
export interface AnalyzeResult {
  summary: string;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Teen-stage pop-up questions
// ---------------------------------------------------------------------------

export type PopupFormat = "choice" | "text" | "order" | "number";
export const POPUP_FORMATS: readonly PopupFormat[] = ["choice", "text", "order", "number"];

export interface PopupQuestion {
  id: string;
  feature: AiFeature;
  format: PopupFormat;
  /** A short made-up scenario, never about the user's real tasks. */
  prompt: string;
  /** "choice": the options. "order": the items to arrange. */
  options?: string[];
  /** "number": the unit, e.g. "minutes". */
  unit?: string;
  /** A suggested way to think about it. Shown after the user answers; never graded. */
  suggested: string;
}

export interface PopupRequest {
  feature: AiFeature;
  formats: PopupFormat[];
  /** Prompts already used, so the model doesn't repeat them. */
  avoid: string[];
}
export interface PopupResult {
  questions: Omit<PopupQuestion, "id" | "feature">[];
}

// ---------------------------------------------------------------------------
// Wire format of POST /api/ai
// ---------------------------------------------------------------------------

export interface AiRequestMap {
  priority: PriorityRequest;
  schedule: ScheduleRequest;
  interrupt: InterruptRequest;
  estimate: EstimateRequest;
  analyze: AnalyzeRequest;
  popup: PopupRequest;
}
export interface AiResultMap {
  priority: PriorityResult;
  schedule: ScheduleResult;
  interrupt: InterruptResult;
  estimate: EstimateResult;
  analyze: AnalyzeResult;
  popup: PopupResult;
}
export type AiKind = keyof AiRequestMap;
export const AI_KINDS: readonly AiKind[] = ["priority", "schedule", "interrupt", "estimate", "analyze", "popup"];

export interface AiCall<K extends AiKind = AiKind> {
  kind: K;
  context: AiContext;
  payload: AiRequestMap[K];
}

export type AiErrorCode = "rate_limited" | "unavailable" | "bad_response" | "bad_request";

export type AiResponse<K extends AiKind = AiKind> =
  | { ok: true; result: AiResultMap[K]; /** True when no API key is set and a demo answer was used. */ mock: boolean }
  | { ok: false; error: AiErrorCode; message: string };
