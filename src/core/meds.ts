import type { ResourceEntry } from "./resources";
import type { ISODateTime } from "./types";

/**
 * Daily medicines: reminders and a log, set up as prescribed. MiOS only
 * reminds and records. It never says what to take, and a
 * medicine typed in by name never moves the charts (only presets do, from
 * their published label data).
 */

/** When one dose is due. Times are local "HH:MM". */
export type DoseTrigger =
  | { kind: "anytime" }
  | { kind: "time"; at: string }
  /** After the first meal logged at or after `after`, plus a wait; optionally red by `remindBy` even with no meal logged. */
  | { kind: "meal"; after: string; waitMinutes: number; remindBy?: string };

export interface MedDose {
  id: string;
  trigger: DoseTrigger;
}

export type MedDays =
  | { kind: "daily" }
  /** 0 = Sunday … 6 = Saturday. */
  | { kind: "weekdays"; days: number[] }
  /** Every other day, counting from this day ("YYYY-MM-DD"). */
  | { kind: "everyOther"; from: string };

export interface DailyMed {
  id: string;
  name: string;
  /** A resource preset this medicine is; logging it then moves the charts too. */
  presetId?: string;
  doses: MedDose[];
  days: MedDays;
  /** false = log only (as needed): no red notes. */
  remind: boolean;
  createdAt: ISODateTime;
  pausedAt?: ISODateTime;
  /** Removed medicines keep their history. */
  removedAt?: ISODateTime;
}

export interface MedLog {
  id: string;
  medId: string;
  /** The dose this answers. Unset for an extra or as-needed dose. */
  doseId?: string;
  /** The medicine day it counts for, "YYYY-MM-DD". */
  day: string;
  at: ISODateTime;
  status: "taken" | "dismissed";
  /** For a preset medicine: the resource entry logged with it, removed with it. */
  entryId?: string;
}

// ---------------------------------------------------------------------------
// Days and times
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const parseHm = (hm: string): [number, number] => {
  const [h, m] = hm.split(":").map(Number);
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
};
export const isHm = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/**
 * The medicine day a moment belongs to. With a day start of 4, 1:30 am still
 * counts for the day before.
 */
export const medDayOf = (ms: number, startHour = 0): string => {
  const d = new Date(ms);
  if (d.getHours() < startHour) d.setDate(d.getDate() - 1);
  return keyOf(d);
};

export const medDayStart = (day: string, startHour = 0): number => {
  const d = parseDay(day);
  d.setHours(startHour, 0, 0, 0);
  return d.getTime();
};

export const medDayEnd = (day: string, startHour = 0): number => {
  const d = parseDay(day);
  d.setDate(d.getDate() + 1);
  d.setHours(startHour, 0, 0, 0);
  return d.getTime();
};

/** "HH:MM" on a medicine day. A time before the day start falls after midnight, on the next calendar date. */
export const timeOnDay = (day: string, hm: string, startHour = 0): number => {
  const [h, m] = parseHm(hm);
  const d = parseDay(day);
  if (h < startHour) d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

export const addDays = (day: string, n: number): string => {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return keyOf(d);
};

const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / (24 * HOUR));

/** Is this medicine meant to be taken (with reminders) on this day? */
export const scheduledOn = (med: DailyMed, day: string, startHour = 0): boolean => {
  if (!med.doses.length) return false;
  if (day < medDayOf(Date.parse(med.createdAt), startHour)) return false;
  if (med.removedAt && day >= medDayOf(Date.parse(med.removedAt), startHour)) return false;
  if (med.pausedAt && day >= medDayOf(Date.parse(med.pausedAt), startHour)) return false;
  switch (med.days.kind) {
    case "daily":
      return true;
    case "weekdays":
      return med.days.days.includes(parseDay(day).getDay());
    case "everyOther": {
      const n = daysBetween(med.days.from, day);
      return n >= 0 && n % 2 === 0;
    }
  }
};

// ---------------------------------------------------------------------------
// Where each dose stands
// ---------------------------------------------------------------------------

export const MEAL_ITEM_ID = "meal";

const DUE_GRACE_MS = 60_000;

export type DoseState =
  | { kind: "taken"; log: MedLog }
  | { kind: "dismissed"; log: MedLog }
  /** Red: time to take it. `noMeal` = red because of "remind me anyway by", with no meal logged. */
  | { kind: "due"; since: number; noMeal?: boolean }
  /** Not yet: due at `at`, or waiting for a meal to be logged. */
  | { kind: "upcoming"; at?: number; waitingForMeal?: boolean }
  /** The day ended with no answer. */
  | { kind: "missed" };

/** The first meal logged in [from, to). */
const firstMeal = (entries: readonly ResourceEntry[], from: number, to: number): number | undefined => {
  let best: number | undefined;
  for (const e of entries) {
    if (e.itemId !== MEAL_ITEM_ID) continue;
    const t = Date.parse(e.at);
    if (t >= from && t < to && (best === undefined || t < best)) best = t;
  }
  return best;
};

/** When a dose became (or becomes) due on a day, if that's known yet. */
export const dueAt = (
  trigger: DoseTrigger,
  day: string,
  entries: readonly ResourceEntry[],
  startHour = 0,
): { at?: number; waitingForMeal?: boolean; remindBy?: number } => {
  switch (trigger.kind) {
    case "anytime":
      return { at: medDayStart(day, startHour) };
    case "time":
      return { at: timeOnDay(day, trigger.at, startHour) };
    case "meal": {
      const meal = firstMeal(entries, timeOnDay(day, trigger.after, startHour), medDayEnd(day, startHour));
      const remindBy = trigger.remindBy ? timeOnDay(day, trigger.remindBy, startHour) : undefined;
      if (meal !== undefined) return { at: meal + Math.max(0, trigger.waitMinutes) * 60_000, remindBy };
      return { waitingForMeal: true, remindBy };
    }
  }
};

const logFor = (logs: readonly MedLog[], medId: string, doseId: string, day: string): MedLog | undefined => {
  let found: MedLog | undefined;
  for (const l of logs) if (l.medId === medId && l.doseId === doseId && l.day === day) found = l;
  return found;
};

export const doseState = (
  med: DailyMed,
  dose: MedDose,
  day: string,
  logs: readonly MedLog[],
  entries: readonly ResourceEntry[],
  now: number,
  startHour = 0,
): DoseState => {
  const log = logFor(logs, med.id, dose.id, day);
  if (log) return log.status === "taken" ? { kind: "taken", log } : { kind: "dismissed", log };
  if (now >= medDayEnd(day, startHour)) return { kind: "missed" };
  const due = dueAt(dose.trigger, day, entries, startHour);
  // Within a minute counts as now: the screen's clock can lag a meal that was just logged.
  if (due.at !== undefined) return now >= due.at - DUE_GRACE_MS ? { kind: "due", since: due.at } : { kind: "upcoming", at: due.at };
  if (due.remindBy !== undefined && now >= due.remindBy) return { kind: "due", since: due.remindBy, noMeal: true };
  return { kind: "upcoming", waitingForMeal: true, at: due.remindBy };
};

export interface Reminder {
  med: DailyMed;
  dose: MedDose;
  /** 1-based, for "dose 2 of 3". */
  index: number;
  state: DoseState;
}

/** Today's doses for medicines with reminders, in the order they come due. */
export const todaysReminders = (
  meds: readonly DailyMed[],
  logs: readonly MedLog[],
  entries: readonly ResourceEntry[],
  now: number,
  startHour = 0,
): Reminder[] => {
  const day = medDayOf(now, startHour);
  const out: Reminder[] = [];
  for (const med of meds) {
    if (!med.remind || !scheduledOn(med, day, startHour)) continue;
    med.doses.forEach((dose, i) => out.push({ med, dose, index: i + 1, state: doseState(med, dose, day, logs, entries, now, startHour) }));
  }
  const rank = (r: Reminder) =>
    r.state.kind === "due" ? r.state.since : r.state.kind === "upcoming" ? (r.state.at ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  return out.sort((a, b) => rank(a) - rank(b));
};

/** Minutes after the dose was due (0 when on time or early); null when it has no due time. */
export const minutesLate = (
  trigger: DoseTrigger,
  day: string,
  takenAt: number,
  entries: readonly ResourceEntry[],
  startHour = 0,
): number | null => {
  if (trigger.kind === "anytime") return null;
  const due = dueAt(trigger, day, entries, startHour);
  const at = due.at ?? due.remindBy;
  if (at === undefined) return null;
  return Math.max(0, Math.round((takenAt - at) / 60_000));
};

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** One day for one medicine, for the 30-day grid. */
export type DayMark =
  | { kind: "off" } // not scheduled (or no reminders): blank
  | { kind: "all"; taken: number; of: number }
  | { kind: "some"; taken: number; of: number }
  | { kind: "dismissed"; of: number }
  | { kind: "missed"; of: number }
  | { kind: "today"; taken: number; of: number }
  /** As needed: how many were logged. */
  | { kind: "logged"; count: number };

export const dayMark = (
  med: DailyMed,
  day: string,
  logs: readonly MedLog[],
  entries: readonly ResourceEntry[],
  now: number,
  startHour = 0,
): DayMark => {
  if (!med.remind || !scheduledOn(med, day, startHour)) {
    const count = logs.filter((l) => l.medId === med.id && l.day === day && l.status === "taken").length;
    return count ? { kind: "logged", count } : { kind: "off" };
  }
  const states = med.doses.map((d) => doseState(med, d, day, logs, entries, now, startHour));
  const of = states.length;
  const taken = states.filter((s) => s.kind === "taken").length;
  const dismissed = states.filter((s) => s.kind === "dismissed").length;
  const open = states.some((s) => s.kind === "due" || s.kind === "upcoming");
  if (taken === of) return { kind: "all", taken, of };
  if (open) return { kind: "today", taken, of };
  if (taken > 0) return { kind: "some", taken, of };
  if (dismissed > 0) return { kind: "dismissed", of };
  return { kind: "missed", of };
};

/** The last `n` medicine days, oldest first, ending today. */
export const lastDays = (now: number, n: number, startHour = 0): string[] => {
  const today = medDayOf(now, startHour);
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
};

/**
 * For the background log (B8): habits only. Never a medicine's name or dose,
 * so nothing identifying about health goes to the AI service.
 */
export const medHabits = (
  meds: readonly DailyMed[],
  logs: readonly MedLog[],
  entries: readonly ResourceEntry[],
  now: number,
  startHour = 0,
): string[] => {
  const days = lastDays(now, 7, startHour).slice(0, -1); // the last 6 finished days
  let scheduled = 0;
  let taken = 0;
  let late = 0;
  let dismissed = 0;
  let missed = 0;
  for (const med of meds) {
    if (!med.remind) continue;
    for (const day of days) {
      if (!scheduledOn(med, day, startHour)) continue;
      for (const dose of med.doses) {
        scheduled++;
        const s = doseState(med, dose, day, logs, entries, now, startHour);
        if (s.kind === "taken") {
          taken++;
          if ((minutesLate(dose.trigger, day, Date.parse(s.log.at), entries, startHour) ?? 0) >= 60) late++;
        } else if (s.kind === "dismissed") dismissed++;
        else if (s.kind === "missed") missed++;
      }
    }
  }
  if (!scheduled) return [];
  return [
    `Daily medicine doses over the last 6 days: ${scheduled} scheduled, ${taken} logged as taken (${late} an hour or more after their time), ${dismissed} reminders dismissed, ${missed} with no answer.`,
  ];
};

// ---------------------------------------------------------------------------
// Schedule presets
// ---------------------------------------------------------------------------

export interface SchedulePreset {
  id: string;
  label: string;
  /** The doses it fills in (all editable afterwards). */
  triggers: DoseTrigger[];
  days?: "daily" | "weekdays" | "everyOther";
  remind: boolean;
}

const at = (t: string): DoseTrigger => ({ kind: "time", at: t });
const meal = (after: string, remindBy?: string): DoseTrigger => ({ kind: "meal", after, waitMinutes: 0, ...(remindBy ? { remindBy } : {}) });

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { id: "once", label: "Once a day, any time", triggers: [{ kind: "anytime" }], remind: true },
  { id: "morning", label: "Every morning (8:00)", triggers: [at("08:00")], remind: true },
  { id: "evening", label: "Every evening (20:00)", triggers: [at("20:00")], remind: true },
  { id: "bedtime", label: "At bedtime (22:00)", triggers: [at("22:00")], remind: true },
  { id: "twice", label: "Twice a day (8:00 and 20:00)", triggers: [at("08:00"), at("20:00")], remind: true },
  { id: "three", label: "Three times a day (8:00, 14:00, 20:00)", triggers: [at("08:00"), at("14:00"), at("20:00")], remind: true },
  { id: "four", label: "Four times a day (8:00, 12:00, 16:00, 20:00)", triggers: [at("08:00"), at("12:00"), at("16:00"), at("20:00")], remind: true },
  { id: "breakfast", label: "After breakfast", triggers: [meal("00:00", "11:00")], remind: true },
  { id: "breakfast-dinner", label: "After breakfast and dinner", triggers: [meal("00:00", "11:00"), meal("17:00", "21:00")], remind: true },
  { id: "each-meal", label: "After each meal (3 doses)", triggers: [meal("00:00", "11:00"), meal("11:30", "15:00"), meal("17:00", "21:00")], remind: true },
  { id: "every-other", label: "Every other day", triggers: [{ kind: "anytime" }], days: "everyOther", remind: true },
  { id: "weekdays", label: "Weekdays only", triggers: [{ kind: "anytime" }], days: "weekdays", remind: true },
  { id: "as-needed", label: "As needed (log only, no reminder)", triggers: [], remind: false },
];

export const describeTrigger = (t: DoseTrigger): string => {
  switch (t.kind) {
    case "anytime":
      return "any time";
    case "time":
      return t.at;
    case "meal": {
      const which = t.after === "00:00" ? "the first meal" : `the first meal after ${t.after}`;
      const wait = t.waitMinutes ? `${t.waitMinutes} min after ` : "after ";
      return `${wait}${which}${t.remindBy ? `, by ${t.remindBy} anyway` : ""}`;
    }
  }
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const describeMed = (med: DailyMed): string => {
  if (!med.remind) return "As needed, log only";
  const days =
    med.days.kind === "daily"
      ? "every day"
      : med.days.kind === "everyOther"
        ? "every other day"
        : med.days.days
            .slice()
            .sort()
            .map((d) => WEEKDAY[d])
            .join(", ");
  const doses = med.doses.length === 1 ? describeTrigger(med.doses[0].trigger) : `${med.doses.length} doses: ${med.doses.map((d) => describeTrigger(d.trigger)).join("; ")}`;
  return `${doses} · ${days}`;
};
