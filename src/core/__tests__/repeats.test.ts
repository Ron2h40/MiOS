import { describe, expect, it } from "vitest";
import {
  buildAgenda,
  deadlineNotAfterStart,
  describePattern,
  dueOccurrences,
  makeSeries,
  occurrenceOn,
  occursOn,
  taskInputFromEvent,
  upcomingOccurrences,
  type CalendarEvent,
} from "..";
import { makeTask } from "./fixtures";

// Monday 9 Nov 2026, local time.
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const at = (d: number, h = 8) => new Date(2026, 10, d, h).getTime();

const first = makeTask({ title: "Standup", mode: "work", priority: 2, scheduledStart: local(9, 9), deadline: local(9, 17), estimateMinutes: 15 });

describe("repeat patterns", () => {
  it("never repeats on or before the first task's own day", () => {
    const s = makeSeries(first, { kind: "daily" }, { id: "s", now: at(9) });
    expect(s.anchorDay).toBe("2026-11-09");
    expect(occursOn(s, "2026-11-09")).toBe(false);
    expect(occursOn(s, "2026-11-10")).toBe(true);
  });

  it("weekdays, chosen weekdays, monthly with short months, and an end date", () => {
    const weekdays = makeSeries(first, { kind: "weekdays" }, { id: "w", now: at(9) });
    expect(occursOn(weekdays, "2026-11-14")).toBe(false); // Saturday
    expect(occursOn(weekdays, "2026-11-16")).toBe(true); // Monday

    const tueThu = makeSeries(first, { kind: "weekly", days: [2, 4] }, { id: "tt", now: at(9) });
    expect(["2026-11-10", "2026-11-11", "2026-11-12"].map((d) => occursOn(tueThu, d))).toEqual([true, false, true]);

    const rent = makeSeries(makeTask({ deadline: new Date(2027, 0, 31, 17).toISOString() }), { kind: "monthly" }, { id: "m", now: at(9) });
    expect(occursOn(rent, "2027-02-28")).toBe(true); // February has no 31st
    expect(occursOn(rent, "2027-03-31")).toBe(true);
    expect(occursOn(rent, "2027-03-30")).toBe(false);

    const short = makeSeries(first, { kind: "daily" }, { id: "u", now: at(9), until: "2026-11-11" });
    expect(occursOn(short, "2026-11-11")).toBe(true);
    expect(occursOn(short, "2026-11-12")).toBe(false);
  });

  it("times repeat exactly: same clock start, same distance to the deadline", () => {
    const s = makeSeries(first, { kind: "daily" }, { id: "s", now: at(9) });
    const o = occurrenceOn(s, "2026-11-12");
    expect(o).toMatchObject({ title: "Standup", mode: "work", priority: 2, scheduledStart: local(12, 9), deadline: local(12, 17) });
    // The time guess is never copied: each day is guessed fresh (A9).
    expect("estimateMinutes" in o).toBe(false);
  });

  it("a deadline days after the start stays days after (trash night, pickup morning)", () => {
    const trash = makeTask({ title: "Trash out", scheduledStart: local(10, 20), deadline: local(11, 7) });
    const o = occurrenceOn(makeSeries(trash, { kind: "weekly", days: [2] }, { id: "t", now: at(9) }), "2026-11-17");
    expect(o.scheduledStart).toBe(local(17, 20));
    expect(o.deadline).toBe(local(18, 7));
  });

  it("makes today's task once, and never catches up missed days", () => {
    const s = makeSeries(first, { kind: "daily" }, { id: "s", now: at(9) });
    expect(dueOccurrences([s], [first], at(12)).map((o) => o.day)).toEqual(["2026-11-12"]);
    const made = makeTask({ repeat: { seriesId: "s", day: "2026-11-12" } });
    expect(dueOccurrences([s], [first, made], at(12))).toEqual([]);
  });

  it("stopping ends future occurrences", () => {
    const s = { ...makeSeries(first, { kind: "daily" }, { id: "s", now: at(9) }), stoppedAt: new Date(at(10)).toISOString() };
    expect(upcomingOccurrences([s], at(9), 5).map((o) => o.day)).toEqual(["2026-11-10"]);
  });

  it("warns when every occurrence would start late", () => {
    expect(deadlineNotAfterStart({ scheduledStart: local(9, 9), deadline: local(9, 9) })).toBe(true);
    expect(deadlineNotAfterStart({ scheduledStart: local(9, 9), deadline: local(9, 10) })).toBe(false);
    expect(describePattern({ kind: "weekly", days: [4, 2] })).toBe("Every Tue, Thu");
  });
});

describe("repeating calendar items: what the time means", () => {
  const ev: CalendarEvent = { key: "k", uid: "u", recurring: true, title: "Problem set", start: local(13, 23), end: local(13, 23, 59), allDay: false, sourceId: "s" };
  it("do it then / due then / do it then, due by the end", () => {
    expect(taskInputFromEvent(ev, "start")).toEqual({ title: "Problem set", scheduledStart: ev.start });
    expect(taskInputFromEvent(ev, "due")).toEqual({ title: "Problem set", deadline: ev.start });
    expect(taskInputFromEvent(ev, "both")).toEqual({ title: "Problem set", scheduledStart: ev.start, deadline: ev.end });
  });
});

describe("agenda", () => {
  it("lists tasks, deadlines, calendar items and upcoming repeats by day, all-day first", () => {
    const s = makeSeries(first, { kind: "daily" }, { id: "s", now: at(9) });
    const holiday: CalendarEvent = { key: "h", uid: "h", recurring: false, title: "Holiday", start: new Date(2026, 10, 10).toISOString(), end: new Date(2026, 10, 11).toISOString(), allDay: true, sourceId: "x" };
    const agenda = buildAgenda(
      { tasks: [first], events: [holiday], decisions: {}, repeats: [s], defaultEstimateMinutes: 30 },
      new Date(2026, 10, 9),
      3,
      at(9),
    );
    expect(agenda.get("2026-11-09")!.map((i) => i.kind)).toEqual(["task", "due"]);
    expect(agenda.get("2026-11-10")!.map((i) => `${i.kind}:${i.title}`)).toEqual(["pending:Holiday", "repeat:Standup"]);
    expect(agenda.get("2026-11-11")!.map((i) => i.kind)).toEqual(["repeat"]);
  });
});
