/**
 * Validate and clean model output. Models can return extra fields, unknown
 * ids, or the wrong shape; nothing reaches the UI without passing through
 * here. Each parser returns null when the output can't be used at all.
 */
import type {
  AiKind,
  AiResultMap,
  AnalyzeResult,
  EstimateResult,
  InterruptResult,
  PopupFormat,
  PopupResult,
  PriorityResult,
  ScheduleResult,
} from "./types";
import { POPUP_FORMATS } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 600): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, maxItems: number, maxLen = 300): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];

export const parsePriority = (raw: unknown, taskIds: readonly string[]): PriorityResult | null => {
  if (!isObj(raw)) return null;
  const known = new Set(taskIds);
  const seen = new Set<string>();
  const order = (Array.isArray(raw.order) ? raw.order : [])
    .map((x) => str(x, 100))
    .filter((id) => known.has(id) && !seen.has(id) && seen.add(id));
  if (!order.length) return null;
  // Any task the model left out keeps its place at the end, so nothing disappears.
  for (const id of taskIds) if (!seen.has(id)) order.push(id);
  const reasons = (Array.isArray(raw.reasons) ? raw.reasons : [])
    .filter(isObj)
    .map((r) => ({ taskId: str(r.taskId, 100), why: str(r.why, 300) }))
    .filter((r) => known.has(r.taskId) && r.why);
  return { order, reasons, why: str(raw.why) || "Ordered by deadline and priority." };
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const parseSchedule = (raw: unknown, taskIds: readonly string[]): ScheduleResult | null => {
  if (!isObj(raw)) return null;
  const known = new Set(taskIds);
  const seen = new Set<string>();
  const slots = (Array.isArray(raw.slots) ? raw.slots : [])
    .filter(isObj)
    .map((s) => ({ taskId: str(s.taskId, 100), start: str(s.start, 5) }))
    .filter((s) => known.has(s.taskId) && HHMM.test(s.start) && !seen.has(s.taskId) && seen.add(s.taskId));
  if (!slots.length) return null;
  return { slots, why: str(raw.why) || "Laid out around your protected time." };
};

export const parseInterrupt = (raw: unknown): InterruptResult | null => {
  if (!isObj(raw)) return null;
  const severity = raw.severity === "high" || raw.severity === "low" || raw.severity === "none" ? raw.severity : null;
  const warning = str(raw.warning, 400);
  if (!severity || !warning) return null;
  return { severity, warning, why: str(raw.why) };
};

export const parseEstimate = (raw: unknown): EstimateResult | null => {
  if (!isObj(raw)) return null;
  const minutes = Math.round(Number(raw.minutes));
  const effort = raw.effort === "low" || raw.effort === "medium" || raw.effort === "high" ? raw.effort : null;
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440 || !effort) return null;
  return { minutes, effort, why: str(raw.why) };
};

export const parseAnalyze = (raw: unknown): AnalyzeResult | null => {
  if (!isObj(raw)) return null;
  const summary = str(raw.summary, 800);
  if (!summary) return null;
  return { summary, notes: strList(raw.notes, 5, 200) };
};

export const parsePopup = (raw: unknown): PopupResult | null => {
  if (!isObj(raw) || !Array.isArray(raw.questions)) return null;
  const questions = raw.questions.filter(isObj).flatMap((q) => {
    const format = POPUP_FORMATS.includes(q.format as PopupFormat) ? (q.format as PopupFormat) : null;
    const prompt = str(q.prompt, 400);
    const suggested = str(q.suggested, 400);
    if (!format || !prompt || !suggested) return [];
    const options = strList(q.options, 5, 120);
    if (format === "choice" && options.length < 2) return [];
    if (format === "order" && options.length < 3) return [];
    return [
      {
        format,
        prompt,
        suggested,
        ...(format === "choice" || format === "order" ? { options: options.slice(0, format === "order" ? 4 : 5) } : {}),
        ...(format === "number" ? { unit: str(q.unit, 30) || "minutes" } : {}),
      },
    ];
  });
  return questions.length ? { questions } : null;
};

/** Dispatch by kind. `taskIds` is needed for kinds whose answer refers to tasks. */
export const parseResult = <K extends AiKind>(kind: K, raw: unknown, taskIds: readonly string[] = []): AiResultMap[K] | null => {
  switch (kind) {
    case "priority":
      return parsePriority(raw, taskIds) as AiResultMap[K] | null;
    case "schedule":
      return parseSchedule(raw, taskIds) as AiResultMap[K] | null;
    case "interrupt":
      return parseInterrupt(raw) as AiResultMap[K] | null;
    case "estimate":
      return parseEstimate(raw) as AiResultMap[K] | null;
    case "analyze":
      return parseAnalyze(raw) as AiResultMap[K] | null;
    case "popup":
      return parsePopup(raw) as AiResultMap[K] | null;
    default:
      return null;
  }
};
