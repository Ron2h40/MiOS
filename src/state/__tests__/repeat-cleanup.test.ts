import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeStreak, keepReason, staleOccurrences, type CalendarEvent, type Task } from "@/core";
import { makeTask } from "@/core/__tests__/fixtures";
import { useMios } from "../store";

/**
 * Repeating days that carry into the next day. The clock is moved for real
 * (fake Date), and `runDaily` plays the part of opening MiOS on a new day.
 */

// Monday 9 Nov 2026 is day 0. Local time throughout.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, 9 + day, h, m);
const iso = (day: number, h: number, m = 0) => at(day, h, m).toISOString();
const st = () => useMios.getState();
const clock = (day: number, h: number, m = 0) => vi.setSystemTime(at(day, h, m));
/** Open MiOS at this moment: today's repeats arrive and replace stale ones. */
const openAt = (day: number, h: number, m = 0) => {
  clock(day, h, m);
  st().runDaily();
};
const byTitle = (title: string) => st().tasks.filter((t) => t.title === title);
const find = (id: string) => st().tasks.find((t) => t.id === id);
const replaced = () => st().events.filter((e) => e.type === "repeat_replaced").map((e) => (e as { taskId: string }).taskId);

const daily = (title: string, start: string, deadline?: string): Task =>
  st().addRepeatingTask({ title, mode: "daily-life", priority: 3, scheduledStart: start, deadline }, { kind: "daily" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  clock(0, 8);
  st().reset();
});
afterEach(() => vi.useRealTimers());

describe("started days", () => {
  it("running across midnight: stays running, today's arrives beside it, and finishing counts its real time", () => {
    const d0 = daily("Deep work", iso(0, 22));
    clock(0, 23);
    expect(st().setTaskState(d0.id, "running").ok).toBe(true);

    openAt(1, 0, 1);
    expect(find(d0.id)?.state).toBe("running");
    expect(byTitle("Deep work")).toHaveLength(2);
    expect(replaced()).toEqual([]);

    // The referee still holds the running cap: today's can't start alongside it.
    const d1 = byTitle("Deep work").find((t) => t.id !== d0.id)!;
    expect(st().setTaskState(d1.id, "running").ok).toBe(false);

    clock(1, 1);
    st().setTaskState(d0.id, "done");
    expect(find(d0.id)?.actualMinutes).toBeCloseTo(120, 0);
    // The finish is logged on the day it happened, so it keeps tomorrow's streak alive.
    expect(computeStreak(st().events, at(1, 9).getTime()).activeToday).toBe(true);
  });

  it("started, then paused overnight: kept on every later day until finished or deleted", () => {
    const d0 = daily("Read", iso(0, 20));
    clock(0, 20);
    st().setTaskState(d0.id, "running");
    clock(0, 20, 30);
    st().setTaskState(d0.id, "ready");
    expect(find(d0.id)?.actualMinutes).toBeCloseTo(30, 0);

    openAt(1, 7);
    openAt(2, 7);
    expect(find(d0.id)).toBeTruthy();
    expect(keepReason(find(d0.id)!, Date.now())).toBe("worked-on");
    // The untouched day in between is the one that gets replaced.
    expect(byTitle("Read")).toHaveLength(2);
    expect(replaced()).toHaveLength(1);
  });

  it("finished, then reopened: kept", () => {
    const d0 = daily("Stretch", iso(0, 9));
    st().setTaskState(d0.id, "done");
    clock(0, 10);
    st().setTaskState(d0.id, "ready");
    openAt(1, 7);
    expect(find(d0.id)?.state).toBe("ready");
    expect(keepReason(find(d0.id)!, Date.now())).toBe("worked-on");
  });

  it("an overnight day finished before its next-morning deadline counts as on time", () => {
    const d0 = daily("Trash out", iso(0, 21), iso(1, 7));
    clock(0, 21);
    st().setTaskState(d0.id, "running");
    openAt(1, 0, 1);
    clock(1, 6);
    st().setTaskState(d0.id, "done");
    expect(st().events.find((e) => e.type === "task_completed")).toMatchObject({ taskId: d0.id, onTime: true });
  });
});

describe("blocked days", () => {
  it("blocked overnight: stays blocked; today's arrives fresh, without the blocker", () => {
    const d0 = daily("Call landlord", iso(0, 10));
    st().addBlocker(d0.id, { kind: "person", label: "Landlord" });
    openAt(1, 7);
    expect(find(d0.id)?.state).toBe("blocked");
    const d1 = byTitle("Call landlord").find((t) => t.id !== d0.id)!;
    expect(d1).toMatchObject({ state: "ready", blockedBy: [] });
  });

  it("unblocked the next day: wakes to Ready and is still kept when later days arrive", () => {
    const d0 = daily("Call landlord", iso(0, 10));
    st().addBlocker(d0.id, { kind: "person", label: "Landlord" });
    openAt(1, 7);
    st().resolveBlocker(d0.id, find(d0.id)!.blockedBy[0].id);
    expect(find(d0.id)?.state).toBe("ready");
    openAt(2, 7);
    expect(find(d0.id)).toBeTruthy();
    expect(keepReason(find(d0.id)!, Date.now())).toBe("worked-on");
  });

  it("blocked by another task that finishes overnight: wakes and is kept", () => {
    const d0 = daily("Send report", iso(0, 16));
    const data = st().addTask({ title: "Get numbers", mode: "job-hunt", priority: 2 });
    st().addBlocker(d0.id, { kind: "task", taskId: data.id });
    openAt(1, 7);
    st().setTaskState(data.id, "done");
    expect(find(d0.id)?.state).toBe("ready");
    openAt(2, 7);
    expect(find(d0.id)).toBeTruthy();
  });

  it("a task blocked by a replaced day is freed, and the freeing is safe", () => {
    const d0 = daily("Stretch", iso(0, 9));
    const after = st().addTask({ title: "Shower", mode: "daily-life", priority: 3 });
    st().addBlocker(after.id, { kind: "task", taskId: d0.id });
    openAt(1, 7);
    expect(find(d0.id)).toBeUndefined();
    expect(find(after.id)).toMatchObject({ state: "ready", blockedBy: [] });
  });
});

describe("untouched and overnight days", () => {
  it("untouched with no deadline: replaced when the next day arrives", () => {
    const d0 = daily("Stretch", iso(0, 9));
    openAt(1, 7);
    expect(replaced()).toEqual([d0.id]);
    expect(byTitle("Stretch")).toHaveLength(1);
  });

  it("overnight day (due next morning) isn't cut short at midnight; replaced after its deadline", () => {
    const d0 = daily("Trash out", iso(0, 21), iso(1, 7));
    openAt(1, 0, 1);
    expect(find(d0.id)).toBeTruthy();
    expect(keepReason(find(d0.id)!, Date.now())).toBe("not-due-yet");
    // Untouched and past its deadline when the following day arrives.
    openAt(2, 7);
    expect(find(d0.id)).toBeUndefined();
    expect(replaced()).toContain(d0.id);
  });

  it("days you didn't open MiOS make nothing; one arrival replaces every untouched earlier day", () => {
    daily("Stretch", iso(0, 9));
    openAt(3, 9);
    expect(byTitle("Stretch")).toHaveLength(1);
    expect(byTitle("Stretch")[0].repeat?.day).toBe("2026-11-12");
  });

  it("opening MiOS again the same day changes nothing", () => {
    daily("Stretch", iso(0, 9));
    openAt(1, 7);
    const before = st().tasks.map((t) => t.id);
    openAt(1, 18);
    expect(st().tasks.map((t) => t.id)).toEqual(before);
  });

  it("calendar items added every time follow the same rules (running overnight stays)", () => {
    const ev = (d: number): CalendarEvent => ({
      key: `shift|${d}`,
      uid: "shift",
      recurring: true,
      title: "Night shift",
      start: iso(d, 22),
      end: iso(d + 1, 6),
      allDay: false,
      sourceId: "x",
    });
    st().importCalendar({ fileName: "work.ics", events: [ev(0), ev(1), ev(2)] });
    st().sortCalendarItems([{ eventKey: "shift|0", choice: "task", scope: "series", mode: "job-hunt", timing: "both" }]);
    const d0 = st().tasks[0];
    clock(0, 22);
    st().setTaskState(d0.id, "running");
    openAt(1, 0, 1);
    expect(find(d0.id)?.state).toBe("running");
    expect(st().tasks.map((t) => t.source?.eventKey).sort()).toEqual(["shift|0", "shift|1"]);
  });
});

describe("the rule itself", () => {
  const arrived = makeTask({ id: "new", repeat: { seriesId: "s", day: "2026-11-10" } });
  const day = (id: string, extra: Partial<Task> = {}) =>
    makeTask({ id, repeat: { seriesId: "s", day: "2026-11-09" }, ...extra });
  const now = at(1, 8).getTime();

  it("only an untouched, past-due (or no-deadline) earlier day of the same series is replaced", () => {
    const tasks = [
      arrived,
      day("untouched"),
      day("edited", { oneOff: true }),
      day("running", { state: "running" }),
      day("blocked", { state: "blocked" }),
      day("paused", { stateChangedAt: iso(0, 21) }),
      day("dueLater", { deadline: iso(1, 12) }),
      day("duePassed", { deadline: iso(1, 7) }),
      day("done", { state: "done" }),
      makeTask({ id: "otherSeries", repeat: { seriesId: "other", day: "2026-11-09" } }),
    ];
    expect(staleOccurrences(tasks, arrived, now).map((t) => t.id)).toEqual(["untouched", "duePassed"]);
  });
});

describe("edited days", () => {
  it("a change of what or when marks the day as edited; a time guess or an unchanged save doesn't", () => {
    const d0 = daily("Stretch", iso(0, 9));
    st().updateTask(d0.id, { estimateMinutes: 10 });
    const t = find(d0.id)!;
    st().updateTask(d0.id, { title: t.title, mode: t.mode, priority: t.priority, scheduledStart: t.scheduledStart, deadline: t.deadline });
    expect(find(d0.id)?.oneOff).toBeUndefined();
    st().updateTask(d0.id, { deadline: iso(0, 12) });
    expect(find(d0.id)?.oneOff).toBe(true);
    openAt(1, 7);
    expect(find(d0.id)).toBeTruthy();
    expect(keepReason(find(d0.id)!, Date.now())).toBe("edited");
  });

  it("moving a day in Google counts as an edit", () => {
    const d0 = daily("Stretch", iso(0, 9));
    st().applyGoogleTaskChanges([{ taskId: d0.id, start: iso(0, 10) }], []);
    expect(find(d0.id)?.oneOff).toBe(true);
  });

  it("a replaced day's Google event is kept as history: its link is dropped, not deleted", () => {
    const d0 = daily("Stretch", iso(0, 9));
    st().updateGoogle({ links: { evt1: { taskId: d0.id, kind: "block", hash: "h" } } });
    openAt(1, 7);
    expect(st().google.links).toEqual({});
  });

  it("a replaced day is never counted as finished", () => {
    daily("Stretch", iso(0, 9));
    openAt(1, 7);
    expect(st().events.some((e) => e.type === "task_completed")).toBe(false);
  });
});
