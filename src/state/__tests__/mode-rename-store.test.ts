import { beforeEach, describe, expect, it } from "vitest";
import { buildSampleTasks } from "../sampleData";
import { useMios } from "../store";

const st = () => useMios.getState();

beforeEach(() => st().reset());

describe("Work mode in the store", () => {
  it("moves Job hunt tasks into Work when an old export is imported", () => {
    const file = {
      version: 1,
      tasks: [
        { id: "a", title: "Send CV", mode: "job-hunt", state: "ready", priority: 2, order: 1, blockedBy: [], isInterrupt: false, actualMinutes: 0 },
      ],
      events: [{ type: "task_created", at: "2026-11-01T00:00:00.000Z", stage: "child", taskId: "a", mode: "job-hunt", isInterrupt: false }],
      settings: {},
      repeats: [{ id: "r", template: { title: "Standup", mode: "job-hunt", priority: 2 } }],
    };
    expect(st().importData(JSON.stringify(file)).ok).toBe(true);
    expect(st().tasks[0].mode).toBe("work");
    expect(st().repeats[0].template.mode).toBe("work");
    expect(JSON.stringify(st().events)).not.toContain("job-hunt");
  });

  it("example tasks use Work, with a deadlock and a long wait to show", () => {
    const tasks = buildSampleTasks(1);
    expect(tasks.filter((t) => t.mode === "work")).toHaveLength(4);
    expect(tasks.filter((t) => t.state === "blocked")).toHaveLength(3);
  });
});
