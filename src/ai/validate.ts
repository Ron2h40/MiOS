/**
 * Validate and clean model output. Models can return extra fields, unknown
 * ids, or the wrong shape; nothing reaches the UI without passing through
 * here. Each parser returns null when the output can't be used at all.
 */
import { cleanSteps, type ResearchSource, type Stage } from "@/core";
import type {
  AiKind,
  AiResultMap,
  AnalyzeResult,
  BreakdownResult,
  CheckStepsResult,
  ResearchResult,
  ReviewResult,
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

/** "9:05", "09:05" or "09:05:00" become "09:05"; anything else is left to fail the check. */
const toHHMM = (v: unknown): string => {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(str(v, 8));
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : str(v, 8);
};

export const parseSchedule = (raw: unknown, taskIds: readonly string[]): ScheduleResult | null => {
  if (!isObj(raw)) return null;
  const known = new Set(taskIds);
  const seen = new Set<string>();
  if (!Array.isArray(raw.slots)) return null;
  const slots = raw.slots
    .filter(isObj)
    .map((s) => ({ taskId: str(s.taskId, 100), start: toHHMM(s.start) }))
    .filter((s) => known.has(s.taskId) && HHMM.test(s.start) && !seen.has(s.taskId) && seen.add(s.taskId));
  // No slots at all is a real answer (nothing fits in what's left of today);
  // slots that were all unusable are not.
  if (!slots.length && raw.slots.length) return null;
  return {
    slots,
    why: str(raw.why) || (slots.length ? "Laid out around your protected time." : "Nothing fits in the time left today."),
  };
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

export const parseBreakdown = (raw: unknown): BreakdownResult | null => {
  if (!isObj(raw)) return null;
  const steps = cleanSteps(strList(raw.steps, 12, 200)).slice(0, 10);
  if (steps.length < 2) return null;
  return { steps, why: str(raw.why) || "Split into steps you can finish one at a time." };
};

export const parseCheckSteps = (raw: unknown, stepCount: number): CheckStepsResult | null => {
  if (!isObj(raw)) return null;
  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .filter(isObj)
    .map((n) => {
      const step = Math.round(Number(n.step));
      return { step: Number.isFinite(step) && step >= 1 && step <= stepCount ? step : 0, note: str(n.note, 300) };
    })
    .filter((n) => n.note)
    .slice(0, 4);
  if (!notes.length) return null;
  return { notes, why: str(raw.why) };
};

export const parseReview = (raw: unknown): ReviewResult | null => {
  if (!isObj(raw)) return null;
  const questions = [...new Set(strList(raw.questions, 5, 200))].slice(0, 3);
  if (questions.length < 2) return null;
  return { questions, why: str(raw.why) || "Questions about how this task went, to help plan the next one." };
};

/** Lines like "**Why:** ..." at the end carry the reasoning. */
const WHY_LINE = /^\W*why\W*:\s*/i;

/** Model text without markdown decoration: headings are dropped; bullets and bold are unwrapped. */
const plain = (text: string): string =>
  text
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/^\s*([-*•]|\d+\.)\s+/, "").replace(/\*\*|__/g, "").trim())
    .filter(Boolean)
    .join("\n");

/**
 * B5: the grounded answer. Sources come only from Google Search's results
 * (never from the model's text), and only web links are kept. At teen stage
 * there is never a summary, whatever the model wrote.
 */
export const parseResearch = (
  text: string,
  sources: readonly ResearchSource[],
  stage: Stage,
  searchWidget?: string,
  provider: ResearchResult["provider"] = "google",
): ResearchResult | null => {
  const seen = new Set<string>();
  const clean = sources
    .map((src) => ({ title: str(src.title, 200), url: str(src.url, 2000) }))
    .filter((src) => /^https?:\/\//i.test(src.url) && !seen.has(src.url) && seen.add(src.url))
    .map((src) => ({ ...src, title: src.title || new URL(src.url).hostname }))
    .slice(0, 8);
  if (!clean.length) return null;
  const lines = plain(text).split("\n");
  const whyAt = lines.findLastIndex((l) => WHY_LINE.test(l));
  const why = whyAt >= 0 ? lines[whyAt].replace(WHY_LINE, "").trim() : "";
  const body = lines.filter((_, i) => i !== whyAt).join("\n").trim().slice(0, 1500);
  return {
    ...(body ? (stage === "teen" ? { guide: body } : { summary: body }) : {}),
    sources: clean,
    why: why || "These are the sources the search found for your question.",
    provider,
    ...(searchWidget ? { searchWidget } : {}),
  };
};

/** B5 fallback: the model's answer about Wikipedia articles, with the articles as the sources. */
export const parseArticleAnswer = (
  raw: unknown,
  articles: readonly ResearchSource[],
  stage: Stage,
): ResearchResult | null => {
  if (!isObj(raw)) return null;
  const text = str(raw.text, 1500);
  const why = str(raw.why, 400);
  return parseResearch(why ? `${text}\nWhy: ${why}` : text, articles, stage, undefined, "wikipedia");
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
    case "breakdown":
      return parseBreakdown(raw) as AiResultMap[K] | null;
    case "checkSteps":
      return parseCheckSteps(raw, taskIds.length) as AiResultMap[K] | null;
    case "review":
      return parseReview(raw) as AiResultMap[K] | null;
    default:
      return null;
  }
};
