import { describe, expect, it } from "vitest";
import { canTransition, finishedOnTime, startTask, transition } from "../process";
import { makeTask, NOW, taskBlocker } from "./fixtures";

describe("process states (A1)", () => {
  it("allows the documented moves and refuses the rest", () => {
    expect(canTransition("ready", "running")).toBe(true);
    expect(canTransition("blocked", "ready")).toBe(true);
    expect(canTransition("done", "ready")).toBe(true);
    expect(canTransition("blocked", "running")).toBe(false);
    expect(canTransition("done", "running")).toBe(false);
  });

  it("accumulates running time when a task leaves Running", () => {
    const running = makeTask({ state: "running", runningSince: "2026-11-05T11:15:00.000Z", actualMinutes: 10 });
    const r = transition(running, "done", NOW);
    expect(r.ok && r.value.actualMinutes).toBe(55);
    expect(r.ok && r.value.completedAt).toBe(NOW);
    expect(r.ok && r.value.runningSince).toBeUndefined();
  });

  it("refuses an illegal move with a reason", () => {
    const r = transition(makeTask({ state: "done" }), "running", NOW);
    expect(r.ok).toBe(false);
  });
});

describe("startTask (A1 + A6 running cap)", () => {
  it("refuses to start past the running cap", () => {
    const a = makeTask({ state: "running", runningSince: NOW });
    const b = makeTask();
    const r = startTask(b, [a, b], { runningCap: 1 }, NOW);
    expect(r.ok).toBe(false);
    expect(startTask(b, [a, b], { runningCap: 2 }, NOW).ok).toBe(true);
  });

  it("refuses to start a task with an active blocker", () => {
    const dep = makeTask({ id: "dep" });
    const t = makeTask({ blockedBy: [taskBlocker("dep")] });
    expect(startTask(t, [dep, t], { runningCap: 3 }, NOW).ok).toBe(false);
    const doneDep = { ...dep, state: "done" as const };
    expect(startTask(t, [doneDep, t], { runningCap: 3 }, NOW).ok).toBe(true);
  });
});

describe("finishedOnTime", () => {
  it("is null without a deadline and compares otherwise", () => {
    expect(finishedOnTime(makeTask({ completedAt: NOW }))).toBeNull();
    expect(finishedOnTime(makeTask({ completedAt: NOW, deadline: "2026-11-06T00:00:00.000Z" }))).toBe(true);
    expect(finishedOnTime(makeTask({ completedAt: NOW, deadline: "2026-11-05T00:00:00.000Z" }))).toBe(false);
  });
});
