import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/core";
import { useMios } from "../store";

const today = (h: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString();
};
const inDays = (n: number, h: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, h).toISOString();
};

const ev = (o: Partial<CalendarEvent> & { key: string }): CalendarEvent => ({
  uid: o.key,
  recurring: false,
  title: o.key,
  start: today(9),
  end: today(10),
  allDay: false,
  sourceId: "x",
  ...o,
});

const gym = ev({ key: "gym|1", uid: "gym", recurring: true, title: "Gym", start: today(18), end: today(19) });
const gymNext = ev({ key: "gym|2", uid: "gym", recurring: true, title: "Gym", start: inDays(7, 18), end: inDays(7, 19) });
const shift = ev({ key: "shift", title: "Work shift", start: today(12), end: today(16) });

describe("calendar in the store", () => {
  beforeEach(() => {
    useMios.getState().reset();
    useMios.getState().importCalendar({ fileName: "life.ics", name: "Life", events: [gym, gymNext, shift] });
  });

  it("re-importing the same file keeps one calendar and the same items", () => {
    for (let i = 0; i < 20; i++) useMios.getState().importCalendar({ fileName: "life.ics", events: [gym, gymNext, shift] });
    const s = useMios.getState();
    expect(s.calendarSources).toHaveLength(1);
    expect(s.calendarEvents).toHaveLength(3);
  });

  it("a file with nothing new (e.g. under another name) leaves no empty calendar behind", () => {
    const r = useMios.getState().importCalendar({ fileName: "copy-of-life.ics", events: [gym, gymNext, shift] });
    expect(r.added).toBe(0);
    expect(useMios.getState().calendarSources).toHaveLength(1);
  });

  it("an added item becomes a normal task, logged like any other; answering twice never doubles it", () => {
    const answer = { eventKey: "shift", choice: "task" as const, scope: "once" as const, mode: "job-hunt" as const };
    expect(useMios.getState().sortCalendarItems([answer]).added).toBe(1);
    expect(useMios.getState().sortCalendarItems([answer]).added).toBe(0);
    const s = useMios.getState();
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ title: "Work shift", mode: "job-hunt", priority: 3, state: "ready", scheduledStart: today(12) });
    expect(s.tasks[0].estimateMinutes).toBeUndefined(); // the time guess stays the user's (A9)
    expect(s.events.filter((e) => e.type === "task_created")).toHaveLength(1);
  });

  it("'every time' on a repeat makes today's task now and future ones on their day, never twice", () => {
    useMios.getState().sortCalendarItems([{ eventKey: "gym|1", choice: "task", scope: "series", mode: "daily-life" }]);
    expect(useMios.getState().tasks).toHaveLength(1);
    expect(useMios.getState().runCalendarDaily()).toBe(0);
    expect(useMios.getState().runCalendarDaily()).toBe(0);
    expect(useMios.getState().tasks).toHaveLength(1);
  });

  it("removing a calendar keeps tasks already made from it", () => {
    useMios.getState().sortCalendarItems([{ eventKey: "shift", choice: "task", scope: "once", mode: "chores" }]);
    const id = useMios.getState().calendarSources[0].id;
    useMios.getState().removeCalendar(id);
    expect(useMios.getState().calendarEvents).toHaveLength(0);
    expect(useMios.getState().tasks).toHaveLength(1);
  });
});
