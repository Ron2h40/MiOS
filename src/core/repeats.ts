import type { ISODateTime, Priority, Task, TaskModeId } from "./types";

/**
 * Repeating tasks made in MiOS. A series is a template plus a pattern. Each
 * occurrence becomes a normal task on its own day (the first time MiOS opens
 * that day), so every occurrence counts on its own for on-time rate, streak
 * and stats. Times repeat exactly: the planned start keeps its clock time and
 * the deadline keeps the same distance from the day it belongs to. A day that
 * needs something different is changed on that day's task. The time guess is
 * not copied: each occurrence is guessed fresh, so time-guess training (A9)
 * only ever measures real guesses.
 */

export type RepeatPattern =
  | { kind: "daily" }
  | { kind: "weekdays" }
  /** 0 = Sunday … 6 = Saturday. */
  | { kind: "weekly"; days: number[] }
  /** Same date each month; months without it use their last day. */
  | { kind: "monthly" };

export interface RepeatSeries {
  id: string;
  template: { title: string; mode: TaskModeId; priority: Priority };
  pattern: RepeatPattern;
  /** Local "YYYY-MM-DD" of the first occurrence (the task the series was made from). */
  anchorDay: string;
  /** Minutes from the occurrence day's midnight. Deadlines may land days later. */
  startMinutes?: number;
  deadlineMinutes?: number;
  /** Last day (inclusive), local "YYYY-MM-DD". */
  until?: string;
  stoppedAt?: ISODateTime;
  createdAt: ISODateTime;
}

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (day: string): Date => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const minutesIntoDay = (iso: ISODateTime, day: Date): number => Math.round((Date.parse(iso) - day.getTime()) / 60_000);

/** A moment on a local day, by minutes from its midnight. Keeps clock time across daylight-saving changes. */
const atMinutes = (day: Date, minutes: number): ISODateTime =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes).toISOString();

/** The day a task belongs to: its planned start, else its deadline, else today. */
export const anchorDayOf = (task: Pick<Task, "scheduledStart" | "deadline">, now: number): string =>
  keyOf(new Date(task.scheduledStart ? Date.parse(task.scheduledStart) : task.deadline ? Date.parse(task.deadline) : now));

/** Build a series from the first task's own times. */
export const makeSeries = (
  task: Pick<Task, "title" | "mode" | "priority" | "scheduledStart" | "deadline">,
  pattern: RepeatPattern,
  opts: { id: string; now: number; until?: string },
): RepeatSeries => {
  const anchorDay = anchorDayOf(task, opts.now);
  const day = parseDay(anchorDay);
  return {
    id: opts.id,
    template: { title: task.title, mode: task.mode, priority: task.priority },
    pattern,
    anchorDay,
    ...(task.scheduledStart ? { startMinutes: minutesIntoDay(task.scheduledStart, day) } : {}),
    ...(task.deadline ? { deadlineMinutes: minutesIntoDay(task.deadline, day) } : {}),
    ...(opts.until ? { until: opts.until } : {}),
    createdAt: new Date(opts.now).toISOString(),
  };
};

const lastDayOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** Does the series have an occurrence on this local day? (The anchor day itself is the original task.) */
export const occursOn = (series: RepeatSeries, day: string): boolean => {
  if (day <= series.anchorDay) return false;
  if (series.until && day > series.until) return false;
  if (series.stoppedAt && day > keyOf(new Date(series.stoppedAt))) return false;
  const d = parseDay(day);
  const p = series.pattern;
  switch (p.kind) {
    case "daily":
      return true;
    case "weekdays":
      return d.getDay() >= 1 && d.getDay() <= 5;
    case "weekly":
      return p.days.includes(d.getDay());
    case "monthly": {
      const want = parseDay(series.anchorDay).getDate();
      return d.getDate() === Math.min(want, lastDayOfMonth(d));
    }
  }
};

export interface Occurrence {
  seriesId: string;
  day: string;
  title: string;
  mode: TaskModeId;
  priority: Priority;
  scheduledStart?: ISODateTime;
  deadline?: ISODateTime;
}

export const occurrenceOn = (series: RepeatSeries, day: string): Occurrence => {
  const d = parseDay(day);
  return {
    seriesId: series.id,
    day,
    title: series.template.title,
    mode: series.template.mode,
    priority: series.template.priority,
    ...(series.startMinutes !== undefined ? { scheduledStart: atMinutes(d, series.startMinutes) } : {}),
    ...(series.deadlineMinutes !== undefined ? { deadline: atMinutes(d, series.deadlineMinutes) } : {}),
  };
};

/** Occurrences due today that don't have their task yet. Missed days are not caught up. */
export const dueOccurrences = (series: readonly RepeatSeries[], tasks: readonly Task[], now: number): Occurrence[] => {
  const today = keyOf(new Date(now));
  const made = new Set(tasks.filter((t) => t.repeat).map((t) => `${t.repeat!.seriesId}|${t.repeat!.day}`));
  return series.filter((s) => occursOn(s, today) && !made.has(`${s.id}|${today}`)).map((s) => occurrenceOn(s, today));
};

/** Upcoming occurrences (after today) within the next `days` days, for previews. */
export const upcomingOccurrences = (series: readonly RepeatSeries[], now: number, days: number): Occurrence[] => {
  const out: Occurrence[] = [];
  const base = new Date(now);
  for (let i = 1; i <= days; i++) {
    const day = keyOf(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
    for (const s of series) if (occursOn(s, day)) out.push(occurrenceOn(s, day));
  }
  return out;
};

/** True when every occurrence would be late the moment it starts. */
export const deadlineNotAfterStart = (t: Pick<Task, "scheduledStart" | "deadline">): boolean =>
  !!t.scheduledStart && !!t.deadline && Date.parse(t.deadline) <= Date.parse(t.scheduledStart);

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const describePattern = (p: RepeatPattern, anchorDay?: string): string => {
  switch (p.kind) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday";
    case "weekly":
      return p.days.length === 7 ? "Every day" : `Every ${[...p.days].sort().map((d) => DAY_NAMES[d]).join(", ")}`;
    case "monthly":
      return anchorDay ? `Monthly on day ${parseDay(anchorDay).getDate()}` : "Monthly";
  }
};
