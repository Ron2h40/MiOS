import { describe, expect, it } from "vitest";
import type { MiosEvent } from "../events";
import { evaluateGate, stageEnteredAt } from "../stages";

const START = "2026-11-01T00:00:00.000Z";
const LATER = "2026-11-02T00:00:00.000Z";

const completed = (n: number, onTime: boolean, stage: "child" | "teen" = "child"): MiosEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    type: "task_completed" as const,
    at: LATER,
    stage,
    taskId: `t${i}`,
    onTime,
    ownChoice: true,
  }));

const suggestions = (overridden: number, accepted: number): MiosEvent[] => [
  ...Array.from({ length: overridden }, () => ({
    type: "ai_suggestion" as const, at: LATER, stage: "child" as const, feature: "B1", outcome: "overridden" as const,
  })),
  ...Array.from({ length: accepted }, () => ({
    type: "ai_suggestion" as const, at: LATER, stage: "child" as const, feature: "B1", outcome: "accepted" as const,
  })),
];

describe("progress gate: child → teen", () => {
  it("passes when every signal passes", () => {
    const events = [...completed(15, true), ...suggestions(2, 8)];
    const r = evaluateGate(events, "child", START, "2026-11-08T00:00:00.000Z");
    expect(r.to).toBe("teen");
    expect(r.signals.every((s) => s.pass)).toBe(true);
    expect(r.ready).toBe(true);
  });

  it("holds back when one signal fails", () => {
    const events = [...completed(15, true), ...suggestions(1, 9)];
    const r = evaluateGate(events, "child", START, "2026-11-08T00:00:00.000Z");
    expect(r.signals.find((s) => s.id === "overrideRate")?.pass).toBe(false);
    expect(r.ready).toBe(false);
  });

  it("treats a rate with no data as not yet passed", () => {
    const r = evaluateGate(completed(15, true), "child", START, "2026-11-08T00:00:00.000Z");
    const s = r.signals.find((x) => x.id === "overrideRate")!;
    expect(s.current).toBeNull();
    expect(s.pass).toBe(false);
  });

  it("leaves tasks without a deadline out of the on-time rate", () => {
    const noDeadline: MiosEvent[] = completed(15, true).map((e) => ({ ...e, onTime: null }));
    const deadlineTasks: MiosEvent[] = [...completed(3, true), ...completed(2, false)];
    const r = evaluateGate([...noDeadline, ...deadlineTasks, ...suggestions(5, 5)], "child", START, "2026-11-08T00:00:00.000Z");
    const s = r.signals.find((x) => x.id === "onTime")!;
    expect(s.sample).toEqual({ hits: 3, total: 5 });
    // They still count as tasks done.
    expect(r.signals.find((x) => x.id === "tasksDone")?.current).toBe(20);
  });

  it("requires the minimum days at stage", () => {
    const events = [...completed(15, true), ...suggestions(5, 5)];
    expect(evaluateGate(events, "child", START, "2026-11-07T23:00:00.000Z").ready).toBe(false);
  });
});

describe("progress gate: teen → adult", () => {
  it("checks AI-free decisions and pop-up answers", () => {
    const decisions: MiosEvent[] = Array.from({ length: 10 }, (_, i) => ({
      type: "decision_made", at: LATER, stage: "teen", usedAi: i < 2, feature: "order",
    }));
    const popups: MiosEvent[] = Array.from({ length: 10 }, (_, i) => ({
      type: "popup_question", at: LATER, stage: "teen", feature: "B1", outcome: i < 7 ? "answered" : "skipped",
    }));
    const r = evaluateGate([...completed(60, true, "teen"), ...decisions, ...popups], "teen", START, "2026-11-22T00:00:00.000Z");
    expect(r.to).toBe("adult");
    expect(r.ready).toBe(true);
  });
});

describe("stage-back rule", () => {
  it("only counts events since the user last entered the stage", () => {
    const events: MiosEvent[] = [
      ...completed(15, true),
      { type: "stage_changed", at: "2026-11-03T00:00:00.000Z", stage: "child", from: "child", to: "teen", reason: "manual" },
      { type: "stage_changed", at: "2026-11-04T00:00:00.000Z", stage: "teen", from: "teen", to: "child", reason: "manual" },
    ];
    const entered = stageEnteredAt(events, "child", START);
    expect(entered).toBe("2026-11-04T00:00:00.000Z");
    const r = evaluateGate(events, "child", entered, "2026-11-20T00:00:00.000Z");
    expect(r.signals.find((s) => s.id === "tasksDone")?.current).toBe(0);
  });

  it("adult stage has no gate", () => {
    expect(evaluateGate([], "adult", START, LATER)).toMatchObject({ to: null, ready: false });
  });
});
