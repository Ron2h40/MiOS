import { beforeEach, describe, expect, it } from "vitest";
import { staleOccurrences, type CalendarEvent } from "@/core";
import { makeTask } from "@/core/__tests__/fixtures";
import { useMios } from "../store";

const at = (dayOffset: number, h: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h).toISOString();
};
const st = () => useMios.getState();

/** A daily repeat whose first day was yesterday; running the daily job makes today's. */
const yesterdaysRepeat = () =>
  st().addRepeatingTask({ title: "Stretch", mode: "daily-life", priority: 3, scheduledStart: at(-1, 8) }, { kind: "daily" });

describe("which earlier days a new one replaces", () => {
  const today = makeTask({ id: "new", repeat: { seriesId: "s", day: "2026-11-10" } });
  const day = (id: string, d: string, extra = {}) => makeTask({ id, repeat: { seriesId: "s", day: d }, ...extra });

  it("only untouched days still waiting in Ready, from the same series, before today", () => {
    const tasks = [
      today,
      day("waiting", "2026-11-09"),
      day("edited", "2026-11-08", { oneOff: true }),
      day("running", "2026-11-08", { state: "running" }),
      day("blocked", "2026-11-07", { state: "blocked" }),
      day("done", "2026-11-06", { state: "done" }),
      makeTask({ id: "other", repeat: { seriesId: "other", day: "2026-11-09" } }),
      makeTask({ id: "plain" }),
    ];
    expect(staleOccurrences(tasks, today).map((t) => t.id)).toEqual(["waiting"]);
  });
});

describe("replacing in the store", () => {
  beforeEach(() => st().reset());

  it("yesterday's untouched day is replaced by today's, and the replacement is logged", () => {
    const old = yesterdaysRepeat();
    st().runDaily();
    const titles = st().tasks.map((t) => t.repeat?.day);
    expect(st().tasks).toHaveLength(1);
    expect(titles[0]).not.toBe(old.repeat!.day);
    expect(st().events.find((e) => e.type === "repeat_replaced")).toMatchObject({ taskId: old.id, byTaskId: st().tasks[0].id });
    // Never faked as finished.
    expect(st().events.some((e) => e.type === "task_completed")).toBe(false);
  });

  it("a day edited by hand stays, labelled as one-off; a time guess alone doesn't count as an edit", () => {
    const old = yesterdaysRepeat();
    st().updateTask(old.id, { estimateMinutes: 10 });
    expect(st().tasks[0].oneOff).toBeUndefined();
    st().updateTask(old.id, { deadline: at(0, 12) });
    expect(st().tasks[0].oneOff).toBe(true);
    st().runDaily();
    expect(st().tasks.map((t) => t.id)).toContain(old.id);
    expect(st().tasks).toHaveLength(2);
  });

  it("saving the edit form without changes doesn't mark a day as edited", () => {
    const old = yesterdaysRepeat();
    const t = st().tasks[0];
    st().updateTask(old.id, { title: t.title, mode: t.mode, priority: t.priority, scheduledStart: t.scheduledStart, deadline: t.deadline });
    expect(st().tasks[0].oneOff).toBeUndefined();
  });

  it("a started day stays", () => {
    const old = yesterdaysRepeat();
    st().setTaskState(old.id, "running");
    st().runDaily();
    expect(st().tasks.find((t) => t.id === old.id)?.state).toBe("running");
  });

  it("moving a day in Google counts as an edit", () => {
    const old = yesterdaysRepeat();
    st().applyGoogleTaskChanges([{ taskId: old.id, start: at(-1, 10) }], []);
    expect(st().tasks[0].oneOff).toBe(true);
  });

  it("a replaced day's Google event is kept as history (its link is forgotten, not deleted)", () => {
    const old = yesterdaysRepeat();
    st().updateGoogle({ links: { evt1: { taskId: old.id, kind: "block", hash: "h" } } });
    st().runDaily();
    expect(st().google.links).toEqual({});
  });

  it("other tasks blocked by a replaced day are freed", () => {
    const old = yesterdaysRepeat();
    const waiter = st().addTask({ title: "After stretch", mode: "daily-life", priority: 3 });
    st().addBlocker(waiter.id, { kind: "task", taskId: old.id });
    expect(st().tasks.find((t) => t.id === waiter.id)?.state).toBe("blocked");
    st().runDaily();
    expect(st().tasks.find((t) => t.id === waiter.id)).toMatchObject({ state: "ready", blockedBy: [] });
  });

  it("works the same for calendar items added every time", () => {
    const ev = (d: number): CalendarEvent => ({
      key: `class|${d}`,
      uid: "class",
      recurring: true,
      title: "Class",
      start: at(d, 9),
      end: at(d, 10),
      allDay: false,
      sourceId: "x",
    });
    st().importCalendar({ fileName: "class.ics", events: [ev(-1), ev(0)] });
    st().sortCalendarItems([{ eventKey: "class|-1", choice: "task", scope: "series", mode: "chores" }]);
    const old = st().tasks[0];
    expect(old.source?.recurring).toBe(true);
    st().runDaily();
    expect(st().tasks.map((t) => t.source?.eventKey)).toEqual(["class|0"]);
    expect(st().events.some((e) => e.type === "repeat_replaced" && e.taskId === old.id)).toBe(true);
  });
});
