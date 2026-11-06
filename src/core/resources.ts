import type { MiosEvent } from "./events";
import type { ISODateTime } from "./types";

/**
 * Section C — resource charts (Focus, Energy, Hydration).
 *
 * Each logged item adds an effect that follows a curve over time: it rises to
 * a peak and fades out. A resource's level at any moment is the sum of every
 * active effect, plus the day's sleep baseline, minus what running tasks cost
 * (C5), clamped to 0–100. These are rough personal estimates, not
 * measurements, and never medical advice.
 */

export type ResourceKey = "focus" | "energy" | "hydration";
export const RESOURCE_KEYS: readonly ResourceKey[] = ["focus", "energy", "hydration"];

export type ItemKind = "drink" | "food" | "sleep" | "medicine";

/** Where a number came from, shown to the user next to it. */
export interface SourceRef {
  title: string;
  url: string;
  /** Label revision or page date, as printed. */
  revised: string;
  section?: string;
  quote: string;
}

export interface CurveFact {
  /** Human wording, e.g. "about 2 hours". */
  value: string;
  /** "label" = FDA prescribing information; "reference" = drug reference; "estimate" = MiOS's own assumption. */
  basis: "label" | "reference" | "estimate";
  source?: SourceRef;
  note?: string;
}

export interface ResourceItem {
  id: string;
  name: string;
  icon: string;
  kind: ItemKind;
  /** What one tap means, e.g. "1 cup (about 95 mg caffeine)". */
  serving: string;
  /** Percentage points added at full effect. */
  effects: Partial<Record<ResourceKey, number>>;
  /** [hours after intake, fraction of full effect]. Starts at [0, 0], ends at fraction 0. */
  shape: readonly (readonly [number, number])[];
  /** Medicines: the published facts the shape is built from. */
  facts?: { peak?: CurveFact; duration?: CurveFact; halfLife?: CurveFact; onset?: CurveFact };
  /** Medicines: e.g. "Generic: methylphenidate HCl, immediate-release". */
  detail?: string;
}

export interface ResourceEntry {
  id: string;
  itemId: string;
  at: ISODateTime;
  /** Sleep only: hours slept (the entry's time is when you woke up). */
  hours?: number;
}

/** C4 — personal tolerance: scale how strong and how long an item works for you. */
export interface Tolerance {
  strength: number;
  duration: number;
}
export const DEFAULT_TOLERANCE: Tolerance = { strength: 1, duration: 1 };
export const TOLERANCE_RANGE = { min: 0.25, max: 2 } as const;

const HOUR_MS = 3_600_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fraction of full effect `hoursSince` hours after intake, by linear interpolation of the shape. */
export const curveAt = (shape: ResourceItem["shape"], hoursSince: number, durationScale = 1): number => {
  if (hoursSince < 0 || shape.length < 2) return 0;
  const h = hoursSince / durationScale;
  for (let i = 1; i < shape.length; i++) {
    const [h0, f0] = shape[i - 1];
    const [h1, f1] = shape[i];
    if (h <= h1) return h1 === h0 ? f1 : f0 + ((f1 - f0) * (h - h0)) / (h1 - h0);
  }
  return 0;
};

/** When an item's effect has fully worn off, in hours after intake. */
export const effectHours = (item: ResourceItem, tol: Tolerance = DEFAULT_TOLERANCE): number =>
  (item.shape.at(-1)?.[0] ?? 0) * tol.duration;

// ---------------------------------------------------------------------------
// Sleep baseline
// ---------------------------------------------------------------------------

/** Sleep sets the day's starting Energy and Focus, which drain over waking hours. */
export const SLEEP_MODEL = {
  fullNightHours: 8,
  energyAtWake: 70,
  focusAtWake: 50,
  /** The baseline drains to zero over this many waking hours. */
  wakingHours: 17,
} as const;

const sleepBaseline = (entry: ResourceEntry, t: number, tol: Tolerance): Partial<Record<ResourceKey, number>> => {
  const since = (t - Date.parse(entry.at)) / HOUR_MS;
  if (since < 0 || since > SLEEP_MODEL.wakingHours * tol.duration) return {};
  const rested = clamp((entry.hours ?? 0) / SLEEP_MODEL.fullNightHours, 0, 1.1);
  const left = 1 - since / (SLEEP_MODEL.wakingHours * tol.duration);
  return {
    energy: SLEEP_MODEL.energyAtWake * rested * left * tol.strength,
    focus: SLEEP_MODEL.focusAtWake * rested * left * tol.strength,
  };
};

// ---------------------------------------------------------------------------
// C5 — task cost
// ---------------------------------------------------------------------------

/** Points drained per hour while a task is Running. */
export const TASK_COST_PER_HOUR: Partial<Record<ResourceKey, number>> = { focus: 8, energy: 6 };

export interface Interval {
  start: number;
  end: number;
}

/** When tasks were Running, rebuilt from the event log. Open intervals end at `now`. */
export const runningIntervals = (events: readonly MiosEvent[], now: number): Interval[] => {
  const open = new Map<string, number>();
  const out: Interval[] = [];
  for (const e of events) {
    if (e.type !== "task_state_changed") continue;
    const t = Date.parse(e.at);
    if (e.to === "running") open.set(e.taskId, t);
    else if (e.from === "running" && open.has(e.taskId)) {
      out.push({ start: open.get(e.taskId)!, end: t });
      open.delete(e.taskId);
    }
  }
  for (const start of open.values()) out.push({ start, end: now });
  return out;
};

/** Hours of running-task time between `from` and `to`. Parallel tasks each count. */
const runningHours = (intervals: readonly Interval[], from: number, to: number): number =>
  intervals.reduce((sum, i) => sum + Math.max(0, Math.min(i.end, to) - Math.max(i.start, from)) / HOUR_MS, 0);

// ---------------------------------------------------------------------------
// Levels and day series
// ---------------------------------------------------------------------------

export interface ResourceInputs {
  entries: readonly ResourceEntry[];
  items: ReadonlyMap<string, ResourceItem>;
  tolerances: Readonly<Record<string, Tolerance>>;
  intervals: readonly Interval[];
}

/** Start of the local day containing `t`. */
export const startOfDay = (t: number): number => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Resource levels (0–100) at time `t`. */
export const levelsAt = (input: ResourceInputs, t: number): Record<ResourceKey, number> => {
  const sum: Record<ResourceKey, number> = { focus: 0, energy: 0, hydration: 0 };

  // Only the latest sleep before `t` sets the baseline.
  let sleep: ResourceEntry | undefined;
  for (const e of input.entries) {
    const item = input.items.get(e.itemId);
    if (!item || Date.parse(e.at) > t) continue;
    const tol = input.tolerances[e.itemId] ?? DEFAULT_TOLERANCE;
    if (item.kind === "sleep") {
      if (!sleep || e.at > sleep.at) sleep = e;
      continue;
    }
    const f = curveAt(item.shape, (t - Date.parse(e.at)) / HOUR_MS, tol.duration);
    if (!f) continue;
    for (const k of RESOURCE_KEYS) sum[k] += (item.effects[k] ?? 0) * f * tol.strength;
  }
  if (sleep) {
    const base = sleepBaseline(sleep, t, input.tolerances[sleep.itemId] ?? DEFAULT_TOLERANCE);
    for (const k of RESOURCE_KEYS) sum[k] += base[k] ?? 0;
  }

  // Task cost accumulates from the start of the day.
  const worked = runningHours(input.intervals, startOfDay(t), t);
  for (const k of RESOURCE_KEYS) sum[k] -= (TASK_COST_PER_HOUR[k] ?? 0) * worked;

  return {
    focus: Math.round(clamp(sum.focus, 0, 100)),
    energy: Math.round(clamp(sum.energy, 0, 100)),
    hydration: Math.round(clamp(sum.hydration, 0, 100)),
  };
};

export interface SeriesPoint extends Record<ResourceKey, number> {
  t: number;
}

/** Levels across one local day, every `stepMinutes`. */
export const daySeries = (input: ResourceInputs, dayStart: number, stepMinutes = 10): SeriesPoint[] => {
  const points: SeriesPoint[] = [];
  const end = dayStart + 24 * HOUR_MS;
  for (let t = dayStart; t <= end; t += stepMinutes * 60_000) points.push({ t, ...levelsAt(input, t) });
  return points;
};

export interface ActiveEffect {
  entry: ResourceEntry;
  item: ResourceItem;
  /** Hours until it has fully worn off. */
  hoursLeft: number;
}

/** Items still working at `t`, longest-lasting first (e.g. "Coffee · 2 h left"). */
export const activeEffects = (input: ResourceInputs, t: number): ActiveEffect[] =>
  input.entries
    .flatMap((entry) => {
      const item = input.items.get(entry.itemId);
      if (!item || item.kind === "sleep") return [];
      const since = (t - Date.parse(entry.at)) / HOUR_MS;
      const left = effectHours(item, input.tolerances[item.id] ?? DEFAULT_TOLERANCE) - since;
      return since >= 0 && left > 0 ? [{ entry, item, hoursLeft: left }] : [];
    })
    .sort((a, b) => b.hoursLeft - a.hoursLeft);

/** Drop entries older than `days` (keeps storage small). Sleep and meds older than a day no longer matter. */
export const pruneEntries = (entries: readonly ResourceEntry[], now: number, days = 30): ResourceEntry[] =>
  entries.filter((e) => now - Date.parse(e.at) <= days * 24 * HOUR_MS);
