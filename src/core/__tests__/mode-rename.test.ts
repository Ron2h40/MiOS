import { describe, expect, it } from "vitest";
import { ALL_MODES, getMode, isModeId, migrateModeIds } from "../modes";

describe("Job hunt mode became Work", () => {
  it("has a Work mode and no Job hunt mode", () => {
    expect(getMode("work").label).toBe("Work");
    expect(isModeId("job-hunt")).toBe(false);
    expect(ALL_MODES.map((m) => m.label)).toEqual(["General", "Work", "Daily life", "Chores"]);
  });

  it("moves every saved mode field to the new id", () => {
    const old = {
      tasks: [
        { id: "a", title: "Send CV", mode: "job-hunt" },
        { id: "b", title: "Laundry", mode: "chores" },
      ],
      repeats: [{ id: "r", template: { title: "Standup", mode: "job-hunt", priority: 2 } }],
      calendarDecisions: { "series|x": { choice: "task", mode: "job-hunt", at: "2026-11-01T00:00:00.000Z" } },
      events: [{ type: "task_created", taskId: "a", mode: "job-hunt", isInterrupt: false }],
    };
    const now = migrateModeIds(old);
    expect(now.tasks.map((t) => t.mode)).toEqual(["work", "chores"]);
    expect(now.repeats[0].template.mode).toBe("work");
    expect(now.calendarDecisions["series|x"].mode).toBe("work");
    expect(now.events[0].mode).toBe("work");
    expect(JSON.stringify(now)).not.toContain("job-hunt");
  });

  it("leaves data that needs no change untouched", () => {
    const data = { tasks: [{ id: "b", mode: "chores" }], settings: { stage: "child" } };
    expect(migrateModeIds(data)).toBe(data);
  });

  it("only renames mode fields, not text that happens to match", () => {
    const data = { title: "job-hunt", note: { mode: "daily-life" } };
    expect(migrateModeIds(data)).toBe(data);
  });
});
