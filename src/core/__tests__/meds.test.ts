import { describe, expect, it } from "vitest";
import {
  dayMark,
  describeMed,
  doseState,
  medDayOf,
  medHabits,
  minutesLate,
  SCHEDULE_PRESETS,
  scheduledOn,
  timeOnDay,
  todaysReminders,
  type DailyMed,
  type MedLog,
  type ResourceEntry,
} from "@/core";

// Local times on Wed 2026-11-11 (and around it).
const t = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = "2026-11-11";

const med = (o: Partial<DailyMed> = {}): DailyMed => ({
  id: "wb",
  name: "Vitamin D",
  doses: [{ id: "d1", trigger: { kind: "time", at: "08:00" } }],
  days: { kind: "daily" },
  remind: true,
  createdAt: iso(t(1, 9)),
  ...o,
});
const meal = (ms: number): ResourceEntry => ({ id: `m${ms}`, itemId: "meal", at: iso(ms) });
const log = (o: Partial<MedLog>): MedLog => ({ id: "l1", medId: "wb", doseId: "d1", day: DAY, at: iso(t(11, 8, 10)), status: "taken", ...o });

describe("medicine days", () => {
  it("start at midnight by default; a later start keeps late-night doses on the day before", () => {
    expect(medDayOf(t(12, 1, 30))).toBe("2026-11-12");
    expect(medDayOf(t(12, 1, 30), 4)).toBe(DAY);
    expect(new Date(timeOnDay(DAY, "02:00", 4)).getDate()).toBe(12);
  });

  it("follow the schedule: every day, chosen weekdays, every other day, pauses and removals", () => {
    expect(scheduledOn(med(), DAY)).toBe(true);
    expect(scheduledOn(med({ days: { kind: "weekdays", days: [1, 2, 4] } }), DAY)).toBe(false); // Wednesday
    expect(scheduledOn(med({ days: { kind: "weekdays", days: [3] } }), DAY)).toBe(true);
    expect(scheduledOn(med({ days: { kind: "everyOther", from: "2026-11-09" } }), DAY)).toBe(true);
    expect(scheduledOn(med({ days: { kind: "everyOther", from: "2026-11-10" } }), DAY)).toBe(false);
    expect(scheduledOn(med({ pausedAt: iso(t(10, 12)) }), DAY)).toBe(false);
    expect(scheduledOn(med({ createdAt: iso(t(12, 9)) }), DAY)).toBe(false);
  });
});

describe("where a dose stands", () => {
  it("a timed dose is neutral before its time, red after, and missed once the day ends", () => {
    expect(doseState(med(), med().doses[0], DAY, [], [], t(11, 7)).kind).toBe("upcoming");
    expect(doseState(med(), med().doses[0], DAY, [], [], t(11, 9))).toEqual({ kind: "due", since: t(11, 8) });
    expect(doseState(med(), med().doses[0], DAY, [], [], t(12, 9)).kind).toBe("missed");
  });

  it("an any-time dose is red from the start of the day", () => {
    const m = med({ doses: [{ id: "d1", trigger: { kind: "anytime" } }] });
    expect(doseState(m, m.doses[0], DAY, [], [], t(11, 0, 5)).kind).toBe("due");
  });

  it("an after-meal dose waits for a meal, turns red when one is logged (after any wait), or by the 'anyway' time", () => {
    const m = med({ doses: [{ id: "d1", trigger: { kind: "meal", after: "17:00", waitMinutes: 30, remindBy: "21:00" } }] });
    const d = m.doses[0];
    expect(doseState(m, d, DAY, [], [meal(t(11, 12))], t(11, 18))).toEqual({ kind: "upcoming", waitingForMeal: true, at: t(11, 21) });
    expect(doseState(m, d, DAY, [], [meal(t(11, 18))], t(11, 18, 10))).toEqual({ kind: "upcoming", at: t(11, 18, 30) });
    expect(doseState(m, d, DAY, [], [meal(t(11, 18))], t(11, 18, 45))).toEqual({ kind: "due", since: t(11, 18, 30) });
    expect(doseState(m, d, DAY, [], [], t(11, 21, 5))).toEqual({ kind: "due", since: t(11, 21), noMeal: true });
  });

  it("taken and dismissed doses stay settled", () => {
    expect(doseState(med(), med().doses[0], DAY, [log({})], [], t(12, 9)).kind).toBe("taken");
    expect(doseState(med(), med().doses[0], DAY, [log({ status: "dismissed" })], [], t(11, 9)).kind).toBe("dismissed");
  });

  it("today's reminders skip log-only medicines and come in the order they're due", () => {
    const twice = med({ doses: [{ id: "a", trigger: { kind: "time", at: "20:00" } }, { id: "b", trigger: { kind: "time", at: "08:00" } }] });
    const asNeeded = med({ id: "x", remind: false, doses: [] });
    const r = todaysReminders([twice, asNeeded], [], [], t(11, 9));
    expect(r.map((x) => [x.dose.id, x.state.kind])).toEqual([
      ["b", "due"],
      ["a", "upcoming"],
    ]);
  });

  it("lateness is measured from the due time", () => {
    expect(minutesLate({ kind: "time", at: "08:00" }, DAY, t(11, 8, 40), [])).toBe(40);
    expect(minutesLate({ kind: "time", at: "08:00" }, DAY, t(11, 7, 50), [])).toBe(0);
    expect(minutesLate({ kind: "anytime" }, DAY, t(11, 23), [])).toBeNull();
  });
});

describe("history and habits", () => {
  it("each day is all, some, dismissed, missed, today, or blank when not scheduled", () => {
    const two = med({ doses: [{ id: "a", trigger: { kind: "time", at: "08:00" } }, { id: "b", trigger: { kind: "time", at: "20:00" } }] });
    const now = t(13, 12);
    expect(dayMark(two, DAY, [log({ doseId: "a" }), log({ id: "l2", doseId: "b" })], [], now)).toEqual({ kind: "all", taken: 2, of: 2 });
    expect(dayMark(two, DAY, [log({ doseId: "a" })], [], now)).toEqual({ kind: "some", taken: 1, of: 2 });
    expect(dayMark(two, DAY, [log({ doseId: "a", status: "dismissed" })], [], now)).toEqual({ kind: "dismissed", of: 2 });
    expect(dayMark(two, DAY, [], [], now)).toEqual({ kind: "missed", of: 2 });
    expect(dayMark(two, "2026-11-13", [], [], now)).toEqual({ kind: "today", taken: 0, of: 2 });
    expect(dayMark(med({ days: { kind: "weekdays", days: [1] } }), DAY, [], [], now)).toEqual({ kind: "off" });
  });

  it("habits for the background log never name the medicine", () => {
    const lines = medHabits([med()], [log({ day: "2026-11-10", at: iso(t(10, 9, 30)) })], [], t(13, 12));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("1 logged as taken (1 an hour or more after their time)");
    expect(lines.join(" ")).not.toMatch(/vitamin d/i);
  });

  it("every schedule preset is described in plain words", () => {
    for (const p of SCHEDULE_PRESETS) {
      const m = med({
        remind: p.remind,
        doses: p.triggers.map((trigger, i) => ({ id: String(i), trigger })),
        days: p.days === "weekdays" ? { kind: "weekdays", days: [1, 2, 3, 4, 5] } : p.days === "everyOther" ? { kind: "everyOther", from: DAY } : { kind: "daily" },
      });
      expect(describeMed(m)).toBeTruthy();
    }
    expect(describeMed(med())).toBe("08:00 · every day");
  });
});
