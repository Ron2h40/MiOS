import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeEvent } from "@/ai/backgroundLog";
import {
  finishedOnTime,
  guessAccuracy,
  minutesFromParts,
  partsFromMinutes,
  reviewDue,
  timeCheckDue,
  tookTooLong,
  type MiosEvent,
} from "@/core";
import { useMios } from "../store";

const st = () => useMios.getState();
const clock = (h: number, m = 0) => new Date(2026, 10, 25, h, m);
const task = (id: string) => st().tasks.find((t) => t.id === id)!;
const nowMs = () => Date.now();

/** Add a task, run it from `from` to `to` (hours), and finish it. */
const runAndFinish = (title: string, guess: number | undefined, from: number, to: number, deadline?: Date) => {
  vi.setSystemTime(clock(from));
  const t = st().addTask({
    title,
    mode: "work",
    priority: 2,
    ...(guess ? { estimateMinutes: guess } : {}),
    ...(deadline ? { deadline: deadline.toISOString() } : {}),
  });
  st().setTaskState(t.id, "running");
  vi.setSystemTime(clock(to));
  st().setTaskState(t.id, "done");
  return t.id;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock(8));
  st().reset();
});
afterEach(() => vi.useRealTimers());

describe("the time check after finishing", () => {
  it("asks only when the task took twice its guess or more", () => {
    const long = runAndFinish("Report", 60, 9, 11); // 120 min vs 60
    expect(timeCheckDue(st().tasks, st().events, nowMs())?.id).toBe(long);

    st().reset();
    runAndFinish("Email", 60, 9, 10); // 60 min vs 60
    expect(timeCheckDue(st().tasks, st().events, nowMs())).toBeUndefined();
  });

  it("never asks about a task without a guess", () => {
    runAndFinish("No guess", undefined, 9, 15);
    expect(timeCheckDue(st().tasks, st().events, nowMs())).toBeUndefined();
  });

  it("is asked once, then the look-back can show", () => {
    const id = runAndFinish("Report", 60, 9, 13);
    // The look-back waits while the time check is due (the runtime checks both).
    expect(reviewDue(st().tasks, st().events, nowMs())?.id).toBe(id);
    st().checkTaskTime(id, null, "finish_check");
    expect(timeCheckDue(st().tasks, st().events, nowMs())).toBeUndefined();
  });

  it("stops asking after a few minutes", () => {
    runAndFinish("Report", 60, 9, 13);
    vi.setSystemTime(clock(13, 11));
    expect(timeCheckDue(st().tasks, st().events, nowMs())).toBeUndefined();
  });

  it("asks again if the task is reopened and finished late again", () => {
    const id = runAndFinish("Report", 60, 9, 13);
    st().checkTaskTime(id, null, "finish_check");
    vi.setSystemTime(clock(14));
    st().setTaskState(id, "ready");
    st().setTaskState(id, "running");
    vi.setSystemTime(clock(15));
    st().setTaskState(id, "done");
    expect(timeCheckDue(st().tasks, st().events, nowMs())?.id).toBe(id);
  });
});

describe("correcting the time", () => {
  it("changes the time taken and logs the correction", () => {
    const id = runAndFinish("Report", 60, 9, 14); // 300 min
    const r = st().checkTaskTime(id, 90, "finish_check");
    expect(r.ok).toBe(true);
    expect(task(id).actualMinutes).toBe(90);
    expect(tookTooLong(task(id))).toBe(false);
    const e = st().events.at(-1)!;
    expect(e).toMatchObject({ type: "time_checked", outcome: "corrected", fromMinutes: 300, toMinutes: 90, where: "finish_check" });
  });

  it("feeds the corrected time to the time-guess training", () => {
    const id = runAndFinish("Report", 60, 9, 14);
    st().checkTaskTime(id, 75, "history");
    const sample = guessAccuracy(st().tasks).samples.find((x) => x.taskId === id)!;
    expect(sample.actual).toBe(75);
  });

  it("never turns a late finish into an on-time one", () => {
    // Deadline 10:00, finish clicked at 14:00: late, even if it "really" took 30 min.
    const id = runAndFinish("Report", 30, 9, 14, clock(10));
    st().checkTaskTime(id, 30, "finish_check");
    expect(finishedOnTime(task(id))).toBe(false);
    expect(task(id).completedAt).toBe(clock(14).toISOString());
    const done = st().events.filter((e) => e.type === "task_completed");
    expect(done.at(-1)).toMatchObject({ onTime: false });
  });

  it("records an unchanged time as kept, and a skip as skipped", () => {
    const id = runAndFinish("Report", 60, 9, 12);
    st().checkTaskTime(id, 180, "finish_check");
    expect(st().events.at(-1)).toMatchObject({ outcome: "kept", toMinutes: 180 });
    st().checkTaskTime(id, null, "history");
    expect(st().events.at(-1)).toMatchObject({ outcome: "skipped" });
    expect(task(id).actualMinutes).toBe(180);
  });

  it("refuses unfinished tasks and impossible times", () => {
    const open = st().addTask({ title: "Open", mode: "work", priority: 2 });
    expect(st().checkTaskTime(open.id, 30, "history").ok).toBe(false);
    const id = runAndFinish("Report", 60, 9, 12);
    expect(st().checkTaskTime(id, 0, "history").ok).toBe(false);
    expect(st().checkTaskTime(id, 8 * 24 * 60, "history").ok).toBe(false);
    expect(task(id).actualMinutes).toBe(180);
  });

  it("is described to the background review in plain words", () => {
    const id = runAndFinish("Report", 60, 9, 14);
    st().checkTaskTime(id, 90, "history");
    const e = st().events.at(-1) as MiosEvent;
    const line = describeEvent(e, new Map(st().tasks.map((t) => [t.id, t])));
    expect(line).toContain('corrected the time "Report" took from 300 to 90 min in History');
    expect(line).toContain("on time or late is unchanged");
  });
});

describe("hours and minutes fields", () => {
  it("reads two fields as minutes", () => {
    expect(minutesFromParts("1", "30")).toBe(90);
    expect(minutesFromParts("", "45")).toBe(45);
    expect(minutesFromParts("2", "")).toBe(120);
    expect(minutesFromParts("", "")).toBeNull();
    expect(minutesFromParts("-1", "0")).toBeNull();
    expect(minutesFromParts("x", "5")).toBeNull();
  });

  it("splits minutes into the two fields", () => {
    expect(partsFromMinutes(322)).toEqual({ hours: 5, minutes: 22 });
    expect(partsFromMinutes(45.4)).toEqual({ hours: 0, minutes: 45 });
  });
});
