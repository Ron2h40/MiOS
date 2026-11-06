/**
 * Teen-stage pop-up questions: the friction step before AI help.
 *
 * They are never graded and never feed the progress gate.
 * The history only exists so the model doesn't repeat itself.
 */
import type { AiFeature, PopupFormat, PopupQuestion } from "./types";
import { POPUP_FORMATS } from "./types";

/** History clears once a feature has used this many questions (saves memory and tokens). */
export const POPUP_HISTORY_LIMIT = 30;

/** Questions kept ready per feature so the pop-up opens instantly. */
export const POPUP_STOCK_TARGET = 3;

/**
 * Remember a shown question. When the history reaches the limit it is
 * cleared and starts fresh.
 */
export const rememberQuestion = (history: readonly string[], prompt: string, limit = POPUP_HISTORY_LIMIT): string[] => {
  const next = [...history, prompt];
  return next.length >= limit ? [] : next;
};

/** Random answer formats for the next batch, so pop-ups don't feel the same. */
export const pickFormats = (count: number, random: () => number = Math.random): PopupFormat[] =>
  Array.from({ length: count }, () => POPUP_FORMATS[Math.floor(random() * POPUP_FORMATS.length)]);

/**
 * Shuffle a copy (Fisher–Yates). Models tend to list "put in order" items
 * already in their suggested order, which would give the answer away.
 * Never returns the original order (for 2+ distinct items).
 */
export const shuffled = <T>(items: readonly T[], random: () => number = Math.random): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  // Landed back on the original order: rotate by one instead.
  if (out.length > 1 && out.every((x, i) => x === items[i])) out.push(out.shift()!);
  return out;
};

/** What the user gave as an answer, per format. */
export type PopupAnswer =
  | { format: "choice"; value: string }
  | { format: "text"; value: string }
  | { format: "order"; value: string[] }
  | { format: "number"; value: string };

/** An answer counts once the user actually engaged with the question. */
export const isAnswered = (a: PopupAnswer): boolean => {
  switch (a.format) {
    case "order":
      return a.value.length > 0;
    case "number":
      return a.value.trim() !== "" && Number.isFinite(Number(a.value));
    default:
      return a.value.trim().length > 0;
  }
};

/** Prompts the model should avoid: everything shown before plus what's already in stock. */
export const avoidList = (history: readonly string[], stock: readonly PopupQuestion[]): string[] => [
  ...history,
  ...stock.map((q) => q.prompt),
];

export const emptyByFeature = <T>(make: () => T): Record<AiFeature, T> => ({
  priority: make(),
  schedule: make(),
  interrupt: make(),
  estimate: make(),
});
