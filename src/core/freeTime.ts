import type { AgendaItem } from "./agenda";
import { occurrences } from "./referee";
import type { ProtectedBlock } from "./types";

/**
 * Free time left today: the gaps between calendar items that take time,
 * tasks with a planned start, and protected time, from now until midnight.
 * Display only; it helps decide when to fit in the next task.
 */

/** Gaps shorter than this aren't worth showing. */
export const MIN_FREE_MINUTES = 15;

export interface DaySlot {
  start: number;
  end: number;
  kind: "task" | "busy" | "protected" | "free";
  title: string;
  taskId?: string;
}

export interface FreeTime {
  slots: DaySlot[];
  freeMinutes: number;
}

/** Agenda kinds that take up time. Deadlines, free calendar items and all-day items don't. */
const TAKES_TIME = new Set<AgendaItem["kind"]>(["task", "busy", "pending", "auto"]);

const nextMidnight = (now: number): number => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};

export const freeTimeToday = (today: readonly AgendaItem[], blocks: readonly ProtectedBlock[], now: number): FreeTime => {
  const end = nextMidnight(now);
  const taken: DaySlot[] = [
    ...today
      .filter((i) => TAKES_TIME.has(i.kind) && !i.allDay && i.end !== undefined && i.end > now && i.start < end)
      .map((i) => ({
        start: i.start,
        end: Math.min(i.end!, end),
        kind: i.kind === "task" ? ("task" as const) : ("busy" as const),
        title: i.title,
        ...(i.taskId ? { taskId: i.taskId } : {}),
      })),
    ...blocks.flatMap((b) =>
      occurrences(b, new Date(now), new Date(end)).map((o) => ({
        start: o.start.getTime(),
        end: Math.min(o.end.getTime(), end),
        kind: "protected" as const,
        title: b.label,
      })),
    ),
  ].sort((a, b) => a.start - b.start || a.end - b.end);

  const minGap = MIN_FREE_MINUTES * 60_000;
  const slots: DaySlot[] = [];
  let cursor = now;
  let free = 0;
  const gap = (to: number) => {
    if (to - cursor < minGap) return;
    slots.push({ start: cursor, end: to, kind: "free", title: "Free" });
    free += to - cursor;
  };
  for (const t of taken) {
    gap(t.start);
    slots.push(t);
    cursor = Math.max(cursor, t.end);
  }
  gap(end);
  return { slots, freeMinutes: Math.round(free / 60_000) };
};
