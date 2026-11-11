import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calendarStatus,
  countByFilter,
  filterHistory,
  historyItems,
  pruneArchive,
  type CalendarEvent,
  type HistoryQuery,
} from "@/core";
import { makeTask } from "@/core/__tests__/fixtures";
import { useMios } from "../store";

const at = (day: number, h: number) => new Date(2026, 10, 9 + day, h);
const iso = (day: number, h: number) => at(day, h).toISOString();
const st = () => useMios.getState();
const clock = (day: number, h: number) => vi.setSystemTime(at(day, h));
const q = (patch: Partial<HistoryQuery> = {}): HistoryQuery => ({ filter: "all", mode: "all", range: "all", search: "", ...patch });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  clock(0, 8);
  st().reset();
});
afterEach(() => vi.useRealTimers());

describe("history list and filters", () => {
  const now = at(3, 12).getTime(); // Thursday
  const onTime = makeTask({ id: "a", title: "Send CV", mode: "job-hunt", state: "done", deadline: iso(2, 17), completedAt: iso(2, 9) });
  const late = makeTask({ id: "b", title: "Rent", state: "done", deadline: iso(1, 17), completedAt: iso(2, 9) });
  const free = makeTask({ id: "c", title: "Read", state: "done", completedAt: iso(-10, 9) });
  const overdue = makeTask({ id: "d", title: "Taxes", state: "ready", deadline: iso(1, 17) });
  const future = makeTask({ id: "e", title: "Later", state: "ready", deadline: iso(9, 17) });
  const archive = [
    { task: makeTask({ id: "f", title: "Stretch", repeat: { seriesId: "s", day: "2026-11-10" } }), reason: "replaced" as const, at: iso(2, 0) },
    { task: makeTask({ id: "g", title: "Old idea" }), reason: "deleted" as const, at: iso(3, 9) },
  ];
  const items = historyItems([onTime, late, free, overdue, future], archive, now);

  it("lists everything that has ended, newest first; open tasks before their deadline aren't history", () => {
    expect(items.map((i) => i.task.id)).toEqual(["g", "a", "b", "f", "d", "c"]);
    expect(items.find((i) => i.task.id === "a")?.onTime).toBe(true);
    expect(items.find((i) => i.task.id === "b")?.onTime).toBe(false);
    expect(items.find((i) => i.task.id === "c")?.onTime).toBeNull();
  });

  it("each filter shows its own kind", () => {
    const ids = (f: HistoryQuery["filter"]) => filterHistory(items, q({ filter: f }), now).map((i) => i.task.id);
    expect(ids("done")).toEqual(["a", "b", "c"]);
    expect(ids("late")).toEqual(["b"]);
    expect(ids("overdue")).toEqual(["d"]);
    expect(ids("replaced")).toEqual(["f"]);
    expect(ids("deleted")).toEqual(["g"]);
    expect(countByFilter(items)).toEqual({ all: 6, done: 3, late: 1, overdue: 1, replaced: 1, deleted: 1 });
  });

  it("mode, time range and search narrow any filter", () => {
    expect(filterHistory(items, q({ mode: "job-hunt" }), now).map((i) => i.task.id)).toEqual(["a"]);
    expect(filterHistory(items, q({ range: "week" }), now).map((i) => i.task.id)).toEqual(["g", "a", "b", "f", "d"]);
    expect(filterHistory(items, q({ search: "  rEn " }), now).map((i) => i.task.id)).toEqual(["b"]);
  });

  it("archived tasks leave for good after 30 days", () => {
    expect(pruneArchive(archive, at(32, 0).getTime()).map((a) => a.task.id)).toEqual(["g"]);
    expect(pruneArchive(archive, at(34, 0).getTime())).toEqual([]);
  });
});

describe("delete, replace, restore", () => {
  it("deleting keeps the task in History; restoring brings it back to Ready", () => {
    const t = st().addTask({ title: "Call bank", mode: "daily-life", priority: 2 });
    st().deleteTask(t.id);
    expect(st().tasks).toHaveLength(0);
    expect(st().archive).toMatchObject([{ reason: "deleted", task: { id: t.id, title: "Call bank" } }]);
    st().restoreTask(t.id);
    expect(st().archive).toHaveLength(0);
    expect(st().tasks).toMatchObject([{ id: t.id, state: "ready", priority: 2 }]);
    // Restoring twice can't duplicate it.
    st().restoreTask(t.id);
    expect(st().tasks).toHaveLength(1);
  });

  it("a deleted finished task comes back finished, with its stats intact", () => {
    const t = st().addTask({ title: "Essay", mode: "daily-life", priority: 3, deadline: iso(1, 17) });
    st().setTaskState(t.id, "running");
    clock(0, 9);
    st().setTaskState(t.id, "done");
    st().deleteTask(t.id);
    st().restoreTask(t.id);
    expect(st().tasks[0]).toMatchObject({ state: "done" });
    expect(st().tasks[0].actualMinutes).toBeCloseTo(60, 0);
  });

  it("a restored task blocked by a task that's gone loses that blocker; a person blocker still blocks", () => {
    const a = st().addTask({ title: "A", mode: "chores", priority: 3 });
    const b = st().addTask({ title: "B", mode: "chores", priority: 3 });
    st().addBlocker(b.id, { kind: "task", taskId: a.id });
    st().addBlocker(b.id, { kind: "person", label: "Sam" });
    st().deleteTask(b.id);
    st().deleteTask(a.id);
    st().purgeArchived(a.id);
    st().restoreTask(b.id);
    const restored = st().tasks.find((t) => t.id === b.id)!;
    expect(restored.blockedBy.map((x) => x.kind)).toEqual(["person"]);
    expect(restored.state).toBe("blocked");
  });

  it("a replaced repeat day goes to History and, once restored, isn't replaced again", () => {
    const d0 = st().addRepeatingTask({ title: "Stretch", mode: "daily-life", priority: 3, scheduledStart: iso(0, 9) }, { kind: "daily" });
    clock(1, 7);
    st().runDaily();
    expect(st().archive).toMatchObject([{ reason: "replaced", task: { id: d0.id } }]);
    st().restoreTask(d0.id);
    clock(2, 7);
    st().runDaily();
    expect(st().tasks.some((t) => t.id === d0.id)).toBe(true);
  });

  it("a restored calendar task is the calendar item's task again (not busy time, not asked again)", () => {
    const ev: CalendarEvent = { key: "gym", uid: "gym", recurring: false, title: "Gym", start: iso(0, 18), end: iso(0, 19), allDay: false, sourceId: "x" };
    st().importCalendar({ fileName: "life.ics", events: [ev] });
    st().sortCalendarItems([{ eventKey: "gym", choice: "task", scope: "once", mode: "daily-life" }]);
    const t = st().tasks[0];
    st().deleteTask(t.id);
    expect(calendarStatus(st().calendarEvents[0], st().calendarDecisions, st().tasks).kind).toBe("busy");
    st().restoreTask(t.id);
    expect(calendarStatus(st().calendarEvents[0], st().calendarDecisions, st().tasks)).toEqual({ kind: "task", taskId: t.id });
  });

  it("the daily job clears archived tasks older than 30 days", () => {
    const t = st().addTask({ title: "Old", mode: "chores", priority: 3 });
    st().deleteTask(t.id);
    clock(31, 8);
    st().runDaily();
    expect(st().archive).toEqual([]);
  });

  it("export and import carry History along", async () => {
    const { exportSnapshot } = await import("../store");
    const t = st().addTask({ title: "Keep me", mode: "chores", priority: 3 });
    st().deleteTask(t.id);
    const json = exportSnapshot();
    st().reset();
    expect(st().importData(json).ok).toBe(true);
    expect(st().archive.map((a) => a.task.title)).toEqual(["Keep me"]);
  });
});
