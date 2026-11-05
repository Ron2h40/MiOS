import { describe, expect, it } from "vitest";
import { previewInterrupt } from "../interrupts";
import { moveInQueue, projectQueue, readyQueue, splitByDeadline } from "../scheduler";
import { makeTask, NOW } from "./fixtures";

describe("scheduler (A2)", () => {
  it("sorts by priority, then earliest deadline, with no deadline last", () => {
    const a = makeTask({ title: "a", priority: 2 });
    const b = makeTask({ title: "b", priority: 2, deadline: "2026-11-07T00:00:00.000Z" });
    const c = makeTask({ title: "c", priority: 1 });
    const d = makeTask({ title: "d", priority: 2, deadline: "2026-11-06T00:00:00.000Z" });
    expect(readyQueue([a, b, c, d], "priority-deadline").map((t) => t.title)).toEqual(["c", "d", "b", "a"]);
  });

  it("moving a task swaps it with its neighbour and touches nothing else", () => {
    const [a, b, c] = [makeTask({ order: 1 }), makeTask({ order: 2 }), makeTask({ order: 3 })];
    const order = moveInQueue([a, b, c], c.id, "up");
    expect([...order]).toEqual([
      [c.id, 2],
      [b.id, 3],
    ]);
    expect(moveInQueue([a, b, c], a.id, "up").size).toBe(0);
  });

  it("moves within a section skip tasks from the other section", () => {
    const timedA = makeTask({ order: 1, deadline: "2026-11-06T00:00:00.000Z" });
    const open = makeTask({ order: 2 });
    const timedB = makeTask({ order: 3, deadline: "2026-11-07T00:00:00.000Z" });
    const { timed, untimed } = splitByDeadline([timedA, open, timedB]);
    expect(timed.map((t) => t.id)).toEqual([timedA.id, timedB.id]);
    expect(untimed.map((t) => t.id)).toEqual([open.id]);
    const order = moveInQueue(timed, timedB.id, "up");
    expect(order.get(timedB.id)).toBe(1);
    expect(order.get(timedA.id)).toBe(3);
    expect(order.has(open.id)).toBe(false);
  });

  it("projects finish times end to end and marks late tasks", () => {
    const a = makeTask({ estimateMinutes: 60 });
    const b = makeTask({ estimateMinutes: 30, deadline: "2026-11-05T13:00:00.000Z" });
    const p = projectQueue([a, b], NOW, 30);
    expect(p[0].finish).toBe("2026-11-05T13:00:00.000Z");
    expect(p[1].finish).toBe("2026-11-05T13:30:00.000Z");
    expect(p[1].late).toBe(true);
  });
});

describe("interrupts (A3)", () => {
  it("shows what an interrupt pushes back without reordering the queue", () => {
    const a = makeTask({ title: "a", estimateMinutes: 30, deadline: "2026-11-05T13:00:00.000Z" });
    const b = makeTask({ title: "b", estimateMinutes: 30 });
    const queue = [a, b];
    const interrupt = makeTask({ title: "call", estimateMinutes: 45, isInterrupt: true });

    const preview = previewInterrupt(queue, interrupt, NOW, 30);

    expect(preview.interruptMinutes).toBe(45);
    expect(preview.pushedBack.map((p) => [p.task.title, p.delayMinutes])).toEqual([
      ["a", 45],
      ["b", 45],
    ]);
    expect(preview.pushedBack[0].newlyLate).toBe(true);
    expect(preview.newlyLateCount).toBe(1);
    expect(queue.map((t) => t.title)).toEqual(["a", "b"]);
  });
});
