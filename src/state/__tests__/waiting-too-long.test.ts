import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findStarved, readyQueue, waitingReason } from "@/core";
import { useMios } from "../store";

const st = () => useMios.getState();
const day = (d: number) => new Date(2026, 10, d, 9, 0);
const flagged = () => findStarved(st().tasks, st().settings, new Date().toISOString()).map((f) => f.task.title);
const byId = () => new Map(st().tasks.map((t) => [t.id, t]));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(day(1));
  st().reset();
});
afterEach(() => vi.useRealTimers());

describe("waiting too long", () => {
  it("says what each flagged task is waiting on", () => {
    const person = st().addTask({ title: "Expense claim", mode: "work", priority: 3 });
    st().addBlocker(person.id, { kind: "person", label: "Finance" });
    const event = st().addTask({ title: "Set up the desk", mode: "chores", priority: 3 });
    st().addBlocker(event.id, { kind: "event", label: "The delivery" });
    const first = st().addTask({ title: "Get sign-off", mode: "work", priority: 2 });
    const second = st().addTask({ title: "Send the plan", mode: "work", priority: 2 });
    st().addBlocker(second.id, { kind: "task", taskId: first.id });
    const idle = st().addTask({ title: "Sort the photos", mode: "daily-life", priority: 4 });

    vi.setSystemTime(day(16));
    expect(flagged()).toEqual(expect.arrayContaining(["Expense claim", "Set up the desk", "Send the plan", "Sort the photos"]));
    const map = byId();
    expect(waitingReason(map.get(person.id)!, map)).toMatchObject({ kind: "person", label: "Finance" });
    expect(waitingReason(map.get(event.id)!, map)).toMatchObject({ kind: "event", label: "The delivery" });
    expect(waitingReason(map.get(second.id)!, map)).toMatchObject({ kind: "task", taskId: first.id, title: "Get sign-off" });
    expect(waitingReason(map.get(idle.id)!, map)).toEqual({ kind: "untouched" });
  });

  it("unblocking a person blocker clears the flag", () => {
    const t = st().addTask({ title: "Expense claim", mode: "work", priority: 3 });
    st().addBlocker(t.id, { kind: "person", label: "Finance" });
    vi.setSystemTime(day(16));
    const why = waitingReason(byId().get(t.id)!, byId());
    if (why.kind !== "person") throw new Error("expected a person blocker");
    st().resolveBlocker(t.id, why.blockerId);
    expect(st().tasks.find((x) => x.id === t.id)?.state).toBe("ready");
    expect(flagged()).not.toContain("Expense claim");
  });

  it.each([
    [1, 16, 17],
    [3, 18, 19],
    [7, 22, 23],
  ])("remind me in %i day(s) hides the flag, then it comes back", (days, stillHidden, back) => {
    const t = st().addTask({ title: "Sort the photos", mode: "daily-life", priority: 4 });
    vi.setSystemTime(day(16));
    st().snoozeWaiting(t.id, days);
    expect(flagged()).not.toContain("Sort the photos");
    vi.setSystemTime(new Date(2026, 10, stillHidden, 8, 59));
    expect(flagged()).not.toContain("Sort the photos");
    vi.setSystemTime(new Date(2026, 10, back, 9, 1));
    expect(flagged()).toContain("Sort the photos");
  });

  it("editing a task doesn't clear its flag", () => {
    const t = st().addTask({ title: "Sort the photos", mode: "daily-life", priority: 4 });
    vi.setSystemTime(day(16));
    st().updateTask(t.id, { title: "Sort the holiday photos", priority: 2 });
    expect(flagged()).toContain("Sort the holiday photos");
  });

  it("move to the top puts it first and rests the flag", () => {
    st().addTask({ title: "Email", mode: "work", priority: 1 });
    const t = st().addTask({ title: "Sort the photos", mode: "daily-life", priority: 4 });
    vi.setSystemTime(day(16));
    st().moveToTop(t.id);
    expect(readyQueue(st().tasks)[0].title).toBe("Sort the photos");
    expect(flagged()).not.toContain("Sort the photos");
  });
});
