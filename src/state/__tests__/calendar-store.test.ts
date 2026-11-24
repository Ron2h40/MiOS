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
    const answer = { eventKey: "shift", choice: "task" as const, scope: "once" as const, mode: "work" as const };
    expect(useMios.getState().sortCalendarItems([answer]).added).toBe(1);
    expect(useMios.getState().sortCalendarItems([answer]).added).toBe(0);
    const s = useMios.getState();
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ title: "Work shift", mode: "work", priority: 3, state: "ready", scheduledStart: today(12) });
    expect(s.tasks[0].estimateMinutes).toBeUndefined(); // the time guess stays the user's (A9)
    expect(s.events.filter((e) => e.type === "task_created")).toHaveLength(1);
  });

  it("'every time' on a repeat makes today's task now and future ones on their day, never twice", () => {
    useMios.getState().sortCalendarItems([{ eventKey: "gym|1", choice: "task", scope: "series", mode: "daily-life" }]);
    expect(useMios.getState().tasks).toHaveLength(1);
    expect(useMios.getState().runDaily()).toBe(0);
    expect(useMios.getState().runDaily()).toBe(0);
    expect(useMios.getState().tasks).toHaveLength(1);
  });

  it("details the user fills in are used; anything left out comes from the item", () => {
    useMios.getState().sortCalendarItems([
      {
        eventKey: "shift",
        choice: "task",
        scope: "once",
        mode: "work",
        details: { title: "Shift at the café", priority: 1, scheduledStart: today(12), estimateMinutes: 240, deadline: today(17) },
      },
    ]);
    expect(useMios.getState().tasks[0]).toMatchObject({
      title: "Shift at the café",
      priority: 1,
      estimateMinutes: 240,
      deadline: today(17),
      scheduledStart: today(12),
      mode: "work",
    });
  });

  it("a repeating item added every time keeps its mode and priority", () => {
    useMios.getState().sortCalendarItems([
      { eventKey: "gym|1", choice: "task", scope: "series", mode: "chores", details: { title: "Gym", priority: 2, scheduledStart: today(18) } },
    ]);
    expect(useMios.getState().calendarDecisions["series:gym"]).toMatchObject({ choice: "task", mode: "chores", priority: 2 });
  });

  it("removing a calendar keeps tasks already made from it", () => {
    useMios.getState().sortCalendarItems([{ eventKey: "shift", choice: "task", scope: "once", mode: "chores" }]);
    const id = useMios.getState().calendarSources[0].id;
    useMios.getState().removeCalendar(id);
    expect(useMios.getState().calendarEvents).toHaveLength(0);
    expect(useMios.getState().tasks).toHaveLength(1);
  });
});

describe("Google items in the store", () => {
  beforeEach(() => useMios.getState().reset());

  const g = (key: string, externalId: string) => ev({ key, externalId, title: key, start: today(8), end: today(9) });

  it("applies Google's deletions by event id, and a full read replaces that calendar's items", () => {
    const st = () => useMios.getState();
    st().applyGoogleItems({ sourceId: "google:primary", name: "Google Calendar", items: [g("a", "ga"), g("b", "gb")], removedIds: [], full: true });
    expect(st().calendarEvents.map((e) => e.key)).toEqual(["a", "b"]);
    st().applyGoogleItems({ sourceId: "google:primary", name: "Google Calendar", items: [], removedIds: ["ga"], full: false });
    expect(st().calendarEvents.map((e) => e.key)).toEqual(["b"]);
    st().applyGoogleItems({ sourceId: "google:primary", name: "Google Calendar", items: [g("c", "gc")], removedIds: [], full: true });
    expect(st().calendarEvents.map((e) => e.key)).toEqual(["c"]);
    expect(st().calendarSources).toHaveLength(1);
  });

  it("moves from Google move the plan; deletes clear it; tasks are never deleted", () => {
    const st = () => useMios.getState();
    const t = st().addTask({ title: "Study", mode: "daily-life", priority: 3, scheduledStart: today(14) });
    st().applyGoogleTaskChanges([{ taskId: t.id, start: today(16) }], []);
    expect(st().tasks[0].scheduledStart).toBe(today(16));
    st().applyGoogleTaskChanges([], [t.id]);
    expect(st().tasks).toHaveLength(1);
    expect(st().tasks[0].scheduledStart).toBeUndefined();
  });

  it("disconnecting removes Google's items, keeps tasks and remembers the MiOS calendar", () => {
    const st = () => useMios.getState();
    st().updateGoogle({ enabled: true, calendarId: "cal-1", links: { x: { taskId: "t", kind: "block", hash: "h" } } });
    st().applyGoogleItems({ sourceId: "google:primary", name: "Google Calendar", items: [g("a", "ga")], removedIds: [], full: true });
    st().addTask({ title: "Keep me", mode: "chores", priority: 3 });
    st().disconnectGoogle();
    expect(st().calendarEvents).toHaveLength(0);
    expect(st().calendarSources).toHaveLength(0);
    expect(st().tasks).toHaveLength(1);
    expect(st().google).toEqual({ enabled: false, syncTokens: {}, links: {}, calendarId: "cal-1" });
  });
});

describe("repeating tasks in the store", () => {
  beforeEach(() => useMios.getState().reset());

  it("the first task is the first occurrence; the next day's comes once, on its day", () => {
    const st = () => useMios.getState();
    const t = st().addRepeatingTask({ title: "Journal", mode: "daily-life", priority: 3, scheduledStart: today(21) }, { kind: "daily" });
    expect(t.repeat?.day).toBe(st().repeats[0].anchorDay);
    expect(st().runDaily()).toBe(0); // today already has its task
    expect(st().tasks).toHaveLength(1);
  });

  it("stopping keeps tasks already made", () => {
    const st = () => useMios.getState();
    const t = st().addRepeatingTask({ title: "Journal", mode: "daily-life", priority: 3 }, { kind: "daily" });
    st().stopRepeating(t.repeat!.seriesId);
    expect(st().repeats[0].stoppedAt).toBeTruthy();
    expect(st().tasks).toHaveLength(1);
  });

  it("a repeating calendar item remembers what its time means", () => {
    const st = () => useMios.getState();
    st().importCalendar({ fileName: "x.ics", events: [gym, gymNext] });
    st().sortCalendarItems([{ eventKey: "gym|1", choice: "task", scope: "series", mode: "daily-life", timing: "both" }]);
    expect(st().tasks[0]).toMatchObject({ scheduledStart: today(18), deadline: today(19) });
    expect(st().calendarDecisions["series:gym"].timing).toBe("both");
  });
});
