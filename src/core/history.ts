import { finishedOnTime } from "./process";
import { monthStart, weekStart } from "./rewards";
import type { ISODateTime, Task, TaskModeId } from "./types";

/**
 * History: a look back at tasks that ended one way or another. Done tasks
 * stay in the task list forever; deleted and replaced tasks move to a small
 * archive that works like a recycle bin (kept 30 days, restorable).
 */

export type ArchiveReason = "deleted" | "replaced";

export interface ArchivedTask {
  task: Task;
  reason: ArchiveReason;
  at: ISODateTime;
}

export const ARCHIVE_DAYS = 30;

/** Drop archived tasks older than the keep window. */
export const pruneArchive = (archive: readonly ArchivedTask[], now: number): ArchivedTask[] =>
  archive.filter((a) => now - Date.parse(a.at) < ARCHIVE_DAYS * 86_400_000);

export type HistoryStatus = "done" | "overdue" | "replaced" | "deleted";
export type HistoryFilter = "all" | "done" | "late" | "overdue" | "replaced" | "deleted";
export type HistoryRange = "week" | "month" | "all";

export interface HistoryItem {
  task: Task;
  status: HistoryStatus;
  /** When it finished, was replaced or deleted; for overdue tasks, the missed deadline. */
  endedAt: ISODateTime;
  /** Finished tasks: on time, late, or no deadline (null). */
  onTime?: boolean | null;
  /** Deleted and replaced tasks: when they leave the archive for good. */
  expiresAt?: ISODateTime;
}

/** Everything in the past, newest first. */
export const historyItems = (tasks: readonly Task[], archive: readonly ArchivedTask[], now: number): HistoryItem[] => {
  const items: HistoryItem[] = [];
  for (const t of tasks) {
    if (t.state === "done" && t.completedAt) {
      items.push({ task: t, status: "done", endedAt: t.completedAt, onTime: finishedOnTime(t) });
    } else if (t.state !== "done" && t.deadline && Date.parse(t.deadline) < now) {
      items.push({ task: t, status: "overdue", endedAt: t.deadline });
    }
  }
  for (const a of archive) {
    items.push({
      task: a.task,
      status: a.reason,
      endedAt: a.at,
      expiresAt: new Date(Date.parse(a.at) + ARCHIVE_DAYS * 86_400_000).toISOString(),
    });
  }
  return items.sort((a, b) => b.endedAt.localeCompare(a.endedAt));
};

export interface HistoryQuery {
  filter: HistoryFilter;
  mode: TaskModeId | "all";
  range: HistoryRange;
  search: string;
}

const matchesFilter = (item: HistoryItem, filter: HistoryFilter): boolean => {
  switch (filter) {
    case "all":
      return true;
    case "done":
      return item.status === "done";
    case "late":
      return item.status === "done" && item.onTime === false;
    default:
      return item.status === filter;
  }
};

export const filterHistory = (items: readonly HistoryItem[], q: HistoryQuery, now: number): HistoryItem[] => {
  const from = q.range === "week" ? weekStart(now) : q.range === "month" ? monthStart(now) : -Infinity;
  const needle = q.search.trim().toLowerCase();
  return items.filter(
    (i) =>
      matchesFilter(i, q.filter) &&
      (q.mode === "all" || i.task.mode === q.mode) &&
      Date.parse(i.endedAt) >= from &&
      (!needle || i.task.title.toLowerCase().includes(needle)),
  );
};

/** How many items each filter would show, for the filter chips. */
export const countByFilter = (items: readonly HistoryItem[]): Record<HistoryFilter, number> => {
  const filters: HistoryFilter[] = ["all", "done", "late", "overdue", "replaced", "deleted"];
  return Object.fromEntries(filters.map((f) => [f, items.filter((i) => matchesFilter(i, f)).length])) as Record<
    HistoryFilter,
    number
  >;
};
