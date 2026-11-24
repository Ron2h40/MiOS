import { describe, expect, it } from "vitest";
import {
  autoTasksToday,
  busyIntervals,
  calendarStatus,
  decisionKey,
  findProtectedConflicts,
  pendingToday,
  pruneCalendar,
  taskInputFromEvent,
  type CalendarEvent,
} from "..";
import { makeTask, NOW } from "./fixtures";

const now = Date.parse(NOW);
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

const ev = (o: Partial<CalendarEvent> & { key: string }): CalendarEvent => ({
  uid: o.key,
  recurring: false,
  title: o.key,
  start: local(5, 9),
  end: local(5, 10),
  allDay: false,
  sourceId: "s",
  ...o,
});

describe("sorting and busy time", () => {
  const lecture = ev({ key: "lec|1", uid: "lec", recurring: true, title: "Lecture", start: local(5, 9), end: local(5, 11) });
  const nextLecture = ev({ key: "lec|2", uid: "lec", recurring: true, title: "Lecture", start: local(12, 9), end: local(12, 11) });
  const lunch = ev({ key: "lunch", title: "Lunch with Sam", start: local(5, 12), end: local(5, 13) });
  const holiday = ev({ key: "hol", title: "Holiday", start: local(5, 0), end: local(6, 0), allDay: true });
  const free = ev({ key: "free", title: "Reminder", free: true });
  const events = [lecture, nextLecture, lunch, holiday, free];

  it("everything starts unsorted, and unsorted timed items are busy time", () => {
    expect(pendingToday(events, {}, [], now).map((e) => e.key)).toEqual(["lec|1", "lunch", "hol", "free"]);
    expect(busyIntervals(events, {}, []).map((b) => b.id)).toEqual(["lec|1", "lec|2", "lunch"]);
  });

  it("'Not MiOS' for a series covers every occurrence", () => {
    const d = { [decisionKey.series(lecture)]: { choice: "busy" as const, at: NOW } };
    expect(calendarStatus(nextLecture, d, [])).toEqual({ kind: "busy", skipped: false });
    expect(pendingToday(events, d, [], now).map((e) => e.key)).toEqual(["lunch", "hol", "free"]);
  });

  it("skipping is busy time today only; a repeat is asked again", () => {
    const d = { [decisionKey.once(lecture)]: { choice: "busy" as const, skipped: true, at: NOW } };
    expect(calendarStatus(lecture, d, [])).toEqual({ kind: "busy", skipped: true });
    expect(calendarStatus(nextLecture, d, [])).toEqual({ kind: "pending" });
  });

  it("an added item is the task: not busy, not asked", () => {
    const task = makeTask({ id: "lunch-task", source: { kind: "calendar", eventKey: "lunch", uid: "lunch" } });
    expect(calendarStatus(lunch, {}, [task])).toEqual({ kind: "task", taskId: "lunch-task" });
    expect(busyIntervals(events, {}, [task]).map((b) => b.id)).not.toContain("lunch");
  });

  it("'always add' series make today's task automatically, once", () => {
    const d = { [decisionKey.series(lecture)]: { choice: "task" as const, mode: "work" as const, at: NOW } };
    expect(autoTasksToday(events, d, [], now).map((e) => e.key)).toEqual(["lec|1"]);
    const made = makeTask({ source: { kind: "calendar", eventKey: "lec|1", uid: "lec" } });
    expect(autoTasksToday(events, d, [made], now)).toEqual([]);
  });

  it("a deleted task from a one-off answer doesn't come back as a question", () => {
    const d = { [decisionKey.once(lunch)]: { choice: "task" as const, taskId: "gone", at: NOW } };
    expect(calendarStatus(lunch, d, [])).toEqual({ kind: "busy", skipped: false });
  });

  it("the referee sees busy calendar time", () => {
    const busy = busyIntervals(events, {}, []);
    const hits = findProtectedConflicts(local(5, 12, 30), 30, [], busy);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ label: "Lunch with Sam", kind: "calendar" });
    expect(findProtectedConflicts(local(5, 13), 30, [], busy)).toHaveLength(0);
  });
});

describe("turning an item into a task", () => {
  it("timed items get a planned start; all-day items get an end-of-day deadline", () => {
    expect(taskInputFromEvent(ev({ key: "a", title: "Gym", start: local(5, 18) }))).toEqual({ title: "Gym", scheduledStart: local(5, 18) });
    expect(taskInputFromEvent(ev({ key: "b", title: "Essay due", start: local(7, 0), end: local(8, 0), allDay: true }))).toEqual({
      title: "Essay due",
      deadline: local(7, 23, 59),
    });
  });
});

describe("pruning", () => {
  it("drops items that ended over 30 days ago, and answers that only pointed at them", () => {
    const old = ev({ key: "old", start: "2026-09-01T09:00:00.000Z", end: "2026-09-01T10:00:00.000Z" });
    const keep = ev({ key: "keep" });
    const d = {
      [decisionKey.once(old)]: { choice: "busy" as const, at: NOW },
      [decisionKey.once(keep)]: { choice: "busy" as const, at: NOW },
    };
    const r = pruneCalendar([old, keep], d, now);
    expect(r.events.map((e) => e.key)).toEqual(["keep"]);
    expect(Object.keys(r.decisions)).toEqual(["once:keep"]);
  });
});
