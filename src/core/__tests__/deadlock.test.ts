import { describe, expect, it } from "vitest";
import { findDeadlocks, wouldDeadlock } from "../deadlock";
import { makeTask, taskBlocker } from "./fixtures";

describe("deadlock check (A4)", () => {
  it("finds no loop in a plain chain", () => {
    const a = makeTask({ id: "a", blockedBy: [taskBlocker("b")] });
    const b = makeTask({ id: "b", blockedBy: [taskBlocker("c")] });
    const c = makeTask({ id: "c" });
    expect(findDeadlocks([a, b, c])).toEqual([]);
  });

  it("finds a three-task loop and returns it as connected edges", () => {
    const a = makeTask({ id: "a", blockedBy: [taskBlocker("b")] });
    const b = makeTask({ id: "b", blockedBy: [taskBlocker("c")] });
    const c = makeTask({ id: "c", blockedBy: [taskBlocker("a")] });
    const [cycle] = findDeadlocks([a, b, c]);
    expect(cycle).toHaveLength(3);
    for (let i = 0; i < cycle.length; i++) {
      expect(cycle[i].blockedByTaskId).toBe(cycle[(i + 1) % cycle.length].taskId);
    }
  });

  it("reports separate loops separately and ignores done tasks", () => {
    const tasks = [
      makeTask({ id: "a", blockedBy: [taskBlocker("b")] }),
      makeTask({ id: "b", blockedBy: [taskBlocker("a")] }),
      makeTask({ id: "x", blockedBy: [taskBlocker("y")] }),
      makeTask({ id: "y", blockedBy: [taskBlocker("x")] }),
      makeTask({ id: "p", blockedBy: [taskBlocker("q")] }),
      makeTask({ id: "q", state: "done", blockedBy: [taskBlocker("p")] }),
    ];
    expect(findDeadlocks(tasks)).toHaveLength(2);
  });

  it("breaking one link clears the loop", () => {
    const a = makeTask({ id: "a", blockedBy: [taskBlocker("b")] });
    const b = makeTask({ id: "b", blockedBy: [taskBlocker("a")] });
    const [cycle] = findDeadlocks([a, b]);
    const broken = cycle[0];
    const fixed = [a, b].map((t) =>
      t.id === broken.taskId ? { ...t, blockedBy: t.blockedBy.filter((x) => x.id !== broken.blockerId) } : t,
    );
    expect(findDeadlocks(fixed)).toEqual([]);
  });

  it("predicts a loop before the link is added", () => {
    const a = makeTask({ id: "a", blockedBy: [taskBlocker("b")] });
    const b = makeTask({ id: "b" });
    expect(wouldDeadlock([a, b], "b", "a")).toBe(true);
    expect(wouldDeadlock([a, b], "a", "b")).toBe(false);
    expect(wouldDeadlock([a, b], "a", "a")).toBe(true);
  });
});
