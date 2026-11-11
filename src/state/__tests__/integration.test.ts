import { beforeEach, describe, expect, it } from "vitest";
import {
  buildWrap,
  computeStreak,
  dueRewards,
  evaluateGate,
  guessAccuracy,
  periodStats,
  stageEnteredAt,
  weekStart,
  type CalendarEvent,
  type MiosEvent,
} from "@/core";
import { isB8Trigger } from "@/ai/backgroundLog";
import { useMios } from "../store";

/**
 * Tasks made by the newer features (calendar check-in, repeats, Google moves)
 * must feed the same event log as typed tasks, so the progress gate, the
 * background log (B8), time-guess training, streaks and stats drops all
 * keep working.
 */

const today = (h: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString();
};
const st = () => useMios.getState();
const types = (events: readonly MiosEvent[]) => events.map((e) => e.type);

const lecture: CalendarEvent = {
  key: "lec|1",
  uid: "lec",
  recurring: true,
  title: "Lecture notes",
  start: today(9),
  end: today(10),
  allDay: false,
  sourceId: "x",
};

const finish = (id: string) => {
  expect(st().setTaskState(id, "running").ok).toBe(true);
  expect(st().setTaskState(id, "done").ok).toBe(true);
};

describe("new task sources feed the same event log", () => {
  beforeEach(() => st().reset());

  it("a calendar task: created, guessed, finished; counted everywhere", () => {
    st().importCalendar({ fileName: "school.ics", events: [lecture] });
    st().sortCalendarItems([
      {
        eventKey: "lec|1",
        choice: "task",
        scope: "series",
        mode: "daily-life",
        timing: "both",
        details: { title: "Lecture notes", priority: 2, scheduledStart: today(9), deadline: "2999-01-01T00:00:00.000Z", estimateMinutes: 40 },
      },
    ]);
    const task = st().tasks[0];
    expect(types(st().events)).toEqual(["task_created", "time_guess"]);

    finish(task.id);
    const done = st().events.find((e) => e.type === "task_completed");
    expect(done).toMatchObject({ taskId: task.id, onTime: true, ownChoice: true });

    // B8 sees the guess and the finish.
    expect(st().events.filter(isB8Trigger).map((e) => e.type)).toEqual(["time_guess", "task_completed"]);

    // Progress gate: the finish counts toward "tasks done" and the on-time rate.
    const { events, settings, startedAt } = st();
    const gate = evaluateGate(events, settings.stage, stageEnteredAt(events, settings.stage, startedAt), new Date().toISOString());
    const done1 = gate.signals.find((s) => s.id === "tasksDone");
    expect(done1?.current).toBe(1);

    // Streak and stats.
    const now = Date.now();
    expect(computeStreak(events, now)).toMatchObject({ current: 1, activeToday: true });
    const week = periodStats(events, weekStart(now), now + 1);
    expect(week).toMatchObject({ tasksDone: 1, onTime: { hits: 1, total: 1 }, activeDays: 1 });

    // Time-guess training measures the guess the user typed.
    expect(st().tasks[0].estimateMinutes).toBe(40);
    expect(guessAccuracy(st().tasks).samples.every((x) => x.estimate === 40)).toBe(true);
  });

  it("a repeating task: the guess you typed counts; copies never pretend to be guesses", () => {
    const t = st().addRepeatingTask(
      { title: "Inbox zero", mode: "job-hunt", priority: 3, scheduledStart: today(8), estimateMinutes: 20 },
      { kind: "daily" },
    );
    expect(types(st().events)).toEqual(["task_created", "time_guess"]);
    expect(st().repeats[0].template).toEqual({ title: "Inbox zero", mode: "job-hunt", priority: 3 });
    finish(t.id);
    expect(st().events.some((e) => e.type === "task_completed" && e.taskId === t.id)).toBe(true);
    // Today already has its occurrence: running the daily job adds nothing and logs nothing.
    const before = st().events.length;
    expect(st().runDaily()).toBe(0);
    expect(st().events.length).toBe(before);
  });

  it("a block moved in Google stays the user's own choice when finished", () => {
    const t = st().addTask({ title: "Write essay", mode: "daily-life", priority: 3, scheduledStart: today(14) });
    st().resolveAiSchedule([{ taskId: t.id, start: today(15) }], "accepted");
    expect(st().tasks[0].aiPlanned).toBe(true);
    st().applyGoogleTaskChanges([{ taskId: t.id, start: today(16) }], []);
    finish(t.id);
    expect(st().events.find((e) => e.type === "task_completed")).toMatchObject({ ownChoice: true });
  });

  it("finished calendar and repeat tasks show up in the weekly stats drop", () => {
    st().importCalendar({ fileName: "school.ics", events: [lecture] });
    st().sortCalendarItems([{ eventKey: "lec|1", choice: "task", scope: "once", mode: "daily-life" }]);
    const r = st().addRepeatingTask({ title: "Stretch", mode: "daily-life", priority: 3 }, { kind: "daily" });
    for (const t of st().tasks) finish(t.id);
    expect(r).toBeTruthy();

    // A week later, this week's wrap is offered and counts both tasks.
    const later = Date.now() + 7 * 86_400_000;
    const due = dueRewards(st().events, later, {});
    const weekly = due.find((d) => d.kind === "weekly");
    expect(weekly).toBeTruthy();
    const stats = periodStats(st().events, weekly!.from, weekly!.to);
    expect(stats.tasksDone).toBe(2);
    const wrap = buildWrap({
      reward: weekly!,
      stats,
      previous: periodStats(st().events, weekly!.from - 7 * 86_400_000, weekly!.from),
      streak: computeStreak(st().events, later),
      levels: null,
      previousLevels: null,
      now: later,
    });
    expect(wrap.cards.find((c) => c.id === "tasks")?.value).toBe("2");
  });

  it("sorting the calendar and syncing don't fake decisions (the gate's no-AI decision rate stays honest)", () => {
    st().importCalendar({ fileName: "school.ics", events: [lecture] });
    st().sortCalendarItems([{ eventKey: "lec|1", choice: "busy", scope: "series", mode: "daily-life" }]);
    st().applyGoogleItems({ sourceId: "google:primary", name: "Google Calendar", items: [], removedIds: [], full: true });
    expect(st().events.filter((e) => e.type === "decision_made")).toHaveLength(0);
  });
});
