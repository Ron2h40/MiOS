import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readyQueue } from "@/core/scheduler";
import { useMios } from "../store";

const st = () => useMios.getState();
const at = (h: number) => new Date(2026, 10, 23, h, 0).toISOString();
const queueTitles = () => readyQueue(st().tasks).map((t) => t.title);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 23, 8, 0));
  st().reset();
});
afterEach(() => vi.useRealTimers());

describe("using a drafted schedule", () => {
  it("puts the queue in the schedule's order", () => {
    const a = st().addTask({ title: "Email", mode: "daily-life", priority: 2 });
    const b = st().addTask({ title: "Essay", mode: "daily-life", priority: 2 });
    const c = st().addTask({ title: "Gym", mode: "daily-life", priority: 2 });
    expect(queueTitles()).toEqual(["Email", "Essay", "Gym"]);

    st().resolveAiSchedule(
      [
        { taskId: a.id, start: at(15) },
        { taskId: b.id, start: at(9) },
        { taskId: c.id, start: at(12) },
      ],
      "accepted",
    );

    expect(queueTitles()).toEqual(["Essay", "Gym", "Email"]);
    expect(st().tasks.find((t) => t.id === b.id)?.scheduledStart).toBe(at(9));
  });

  it("leaves tasks outside the schedule where they were", () => {
    const a = st().addTask({ title: "Email", mode: "daily-life", priority: 2 });
    st().addTask({ title: "Laundry", mode: "chores", priority: 2 });
    const c = st().addTask({ title: "Gym", mode: "daily-life", priority: 2 });

    st().resolveAiSchedule(
      [
        { taskId: a.id, start: at(15) },
        { taskId: c.id, start: at(9) },
      ],
      "overridden",
    );

    expect(queueTitles()).toEqual(["Gym", "Laundry", "Email"]);
  });

  it("changes nothing when the draft isn't used", () => {
    st().addTask({ title: "Email", mode: "daily-life", priority: 2 });
    st().addTask({ title: "Essay", mode: "daily-life", priority: 2 });
    st().resolveAiSchedule([], "overridden");
    expect(queueTitles()).toEqual(["Email", "Essay"]);
  });
});
