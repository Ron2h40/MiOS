import { calendarStatus, type CalendarEvent, type Decisions } from "./calendar";
import { occursOn, occurrenceOn, type RepeatSeries } from "./repeats";
import { dayKey } from "./rewards";
import type { Task, TaskModeId } from "./types";

/**
 * One list of what's on each day, for every calendar view (the Calendar
 * screen and the mini calendar on each mode). Display only: tasks, deadlines,
 * calendar items with their sorting status, and upcoming repeats.
 */

export type AgendaKind =
  /** A task with a planned start. */
  | "task"
  /** A task's deadline. */
  | "due"
  /** Calendar time the referee protects. */
  | "busy"
  /** All-day or "free" calendar items: shown, never blocking. */
  | "free"
  /** Not sorted yet (counts as busy). */
  | "pending"
  /** A repeating calendar item that becomes a task on its day. */
  | "auto"
  /** A repeating MiOS task that will appear on its day. */
  | "repeat";

export interface AgendaItem {
  id: string;
  day: string;
  kind: AgendaKind;
  title: string;
  start: number;
  /** Set for items with a length. */
  end?: number;
  allDay?: boolean;
  mode?: TaskModeId;
  taskId?: string;
}

export interface AgendaInput {
  tasks: readonly Task[];
  events: readonly CalendarEvent[];
  decisions: Decisions;
  repeats: readonly RepeatSeries[];
  defaultEstimateMinutes: number;
}

/** Items between two local days (inclusive), grouped by day, in time order (all-day first). */
export const buildAgenda = (input: AgendaInput, fromDay: Date, days: number, now: number): Map<string, AgendaItem[]> => {
  const start = new Date(fromDay.getFullYear(), fromDay.getMonth(), fromDay.getDate());
  const keys = Array.from({ length: days }, (_, i) => dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime()));
  const out = new Map<string, AgendaItem[]>(keys.map((k) => [k, []]));
  const put = (item: Omit<AgendaItem, "day">) => out.get(dayKey(item.start))?.push({ ...item, day: dayKey(item.start) });

  for (const t of input.tasks) {
    if (t.state === "done") continue;
    if (t.scheduledStart) {
      const s = Date.parse(t.scheduledStart);
      put({ id: `s-${t.id}`, kind: "task", title: t.title, start: s, end: s + (t.estimateMinutes ?? input.defaultEstimateMinutes) * 60_000, mode: t.mode, taskId: t.id });
    }
    if (t.deadline) put({ id: `d-${t.id}`, kind: "due", title: t.title, start: Date.parse(t.deadline), mode: t.mode, taskId: t.id });
  }

  for (const e of input.events) {
    const status = calendarStatus(e, input.decisions, input.tasks);
    if (status.kind === "task") continue; // the task itself is listed
    const kind: AgendaKind =
      status.kind === "pending" ? "pending" : status.kind === "auto-task" ? "auto" : e.allDay || e.free ? "free" : "busy";
    put({ id: `e-${e.key}`, kind, title: e.title, start: Date.parse(e.start), end: Date.parse(e.end), allDay: e.allDay });
  }

  // Repeats that haven't become tasks yet: tomorrow onward (today's is made in the morning).
  const today = dayKey(now);
  for (const k of keys) {
    if (k <= today) continue;
    for (const series of input.repeats) {
      if (!occursOn(series, k)) continue;
      const o = occurrenceOn(series, k);
      const [y, m, d] = k.split("-").map(Number);
      const startMs = o.scheduledStart ? Date.parse(o.scheduledStart) : o.deadline ? Date.parse(o.deadline) : new Date(y, m - 1, d).getTime();
      out.get(k)?.push({
        id: `r-${series.id}-${k}`,
        day: k,
        kind: "repeat",
        title: o.title,
        start: startMs,
        ...(o.scheduledStart ? { end: startMs + (o.estimateMinutes ?? input.defaultEstimateMinutes) * 60_000 } : {}),
        allDay: !o.scheduledStart && !o.deadline,
        mode: o.mode,
      });
    }
  }

  for (const list of out.values()) list.sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start - b.start);
  return out;
};

/** Is this item happening right now? */
export const isNow = (item: AgendaItem, now: number): boolean =>
  !item.allDay && item.end !== undefined && item.start <= now && now < item.end;
