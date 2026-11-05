import { describe, expect, it } from "vitest";
import { findProtectedConflicts } from "../referee";
import { findStarved } from "../starvation";
import { guessAccuracy } from "../timeGuess";
import type { ProtectedBlock } from "../types";
import { makeTask, NOW } from "./fixtures";

// Local-time dates, so these tests pass in any timezone.
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

const sleep: ProtectedBlock = { id: "s", label: "Sleep", days: [], start: "23:00", end: "07:00" };
const gym: ProtectedBlock = { id: "g", label: "Gym", days: [1, 3, 5], start: "18:00", end: "19:00" };

describe("referee protected time (A6)", () => {
  it("catches a slot inside an overnight block, including the morning half", () => {
    expect(findProtectedConflicts(local(5, 23, 30), 30, [sleep])).toHaveLength(1);
    expect(findProtectedConflicts(local(6, 6, 0), 30, [sleep])).toHaveLength(1);
    expect(findProtectedConflicts(local(6, 9, 0), 60, [sleep])).toHaveLength(0);
  });

  it("catches a slot that runs into a block", () => {
    expect(findProtectedConflicts(local(5, 22, 30), 60, [sleep])).toHaveLength(1);
  });

  it("respects the block's weekdays", () => {
    // 2026-11-06 is a Friday (5), 2026-11-07 a Saturday (6).
    expect(findProtectedConflicts(local(6, 18, 15), 30, [gym])).toHaveLength(1);
    expect(findProtectedConflicts(local(7, 18, 15), 30, [gym])).toHaveLength(0);
  });
});

describe("starvation flag (A5)", () => {
  it("flags blocked or waiting tasks past the threshold", () => {
    const old = makeTask({ state: "blocked", stateChangedAt: "2026-10-20T12:00:00.000Z" });
    const fresh = makeTask({ state: "blocked", stateChangedAt: "2026-11-01T12:00:00.000Z" });
    const done = makeTask({ state: "done", stateChangedAt: "2026-10-01T12:00:00.000Z" });
    const flags = findStarved([old, fresh, done], { starvationDays: 14 }, NOW);
    expect(flags.map((f) => [f.task.id, f.daysWaiting])).toEqual([[old.id, 16]]);
  });
});

describe("time-guess training (A9)", () => {
  it("measures how far guesses land from actual time", () => {
    const tasks = [
      makeTask({ state: "done", estimateMinutes: 30, actualMinutes: 60, completedAt: "2026-11-01T00:00:00.000Z" }),
      makeTask({ state: "done", estimateMinutes: 60, actualMinutes: 60, completedAt: "2026-11-02T00:00:00.000Z" }),
      makeTask({ state: "ready", estimateMinutes: 10 }),
    ];
    const g = guessAccuracy(tasks);
    expect(g.samples).toHaveLength(2);
    expect(g.meanErrorPct).toBe(50);
    expect(g.medianRatio).toBe(1.5);
  });

  it("returns nulls with no data", () => {
    expect(guessAccuracy([]).meanErrorPct).toBeNull();
  });
});
