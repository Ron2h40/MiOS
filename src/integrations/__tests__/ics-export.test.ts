import { beforeEach, describe, expect, it } from "vitest";
import { exportableEvents, mergeEvents, type CalendarEvent, type CalendarSource } from "@/core";
import { makeTask, NOW } from "@/core/__tests__/fixtures";
import { useMios } from "@/state/store";
import { buildIcs, parseIcs } from "../ics";

const now = Date.parse(NOW); // 2026-11-05T12:00Z
const settings = { defaultEstimateMinutes: 30 };

const ev = (key: string, sourceId: string, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key,
  uid: key.split("|")[0],
  recurring: key.includes("|"),
  title: key,
  start: "2026-11-06T09:00:00.000Z",
  end: "2026-11-06T10:00:00.000Z",
  allDay: false,
  sourceId,
  ...o,
});
const src = (id: string, o: Partial<CalendarSource> = {}): CalendarSource => ({ id, kind: "ics", name: id, importedAt: NOW, ...o });

const sources = [src("work", { name: "Work" }), src("life", { name: "Life" }), src("google:mios", { kind: "google", mios: true })];
const standup = ev("standup@work", "work", { title: "Standup", location: "Room 2, floor 3" });
const gymMon = ev("gym@life|2026-11-09T18:00:00.000Z", "life", { title: "Gym", start: "2026-11-09T18:00:00.000Z", end: "2026-11-09T19:00:00.000Z" });
const gymMoved = ev("gym@life|2026-11-16T18:00:00.000Z", "life", { title: "Gym", start: "2026-11-17T18:00:00.000Z", end: "2026-11-17T19:00:00.000Z" });
const holiday = ev("hol@life", "life", { title: "Holiday", start: "2026-11-11T00:00:00.000Z", end: "2026-11-12T00:00:00.000Z", allDay: true, free: true });
const essayItem = ev("essay@work", "work", { title: "Essay" });
const echo = ev("task-t9@mios", "work", { title: "Old block", miosTaskId: "t9" });
const sideNote = ev("note@g", "google:mios", { title: "Added in Google" });
const elsewhere = ev("x@other", "gone", { title: "From a removed calendar" });

const essay = makeTask({ id: "t1", title: "Essay", source: { kind: "calendar", eventKey: "essay@work", uid: "essay@work" } });
const plan = makeTask({ id: "t2", title: "Plan week", scheduledStart: "2026-11-06T15:00:00.000Z" });
const tasks = [essay, plan];
const all = [standup, gymMon, gymMoved, holiday, essayItem, echo, sideNote, elsewhere];

describe("picking calendar items for an export", () => {
  it("takes only the chosen calendars, plus MiOS's own Google calendar", () => {
    expect(exportableEvents(all, sources, tasks, []).map((e) => e.key)).toEqual(["note@g"]);
    expect(exportableEvents(all, sources, tasks, ["work"]).map((e) => e.key)).toEqual(["standup@work", "note@g"]);
    expect(exportableEvents(all, sources, tasks, ["gone"]).map((e) => e.key)).toEqual(["note@g"]);
  });

  it("an item that's a MiOS task, or MiOS's own export coming back, goes out once: as MiOS's", () => {
    const keys = exportableEvents(all, sources, tasks, ["work", "life"]).map((e) => e.key);
    expect(keys).not.toContain("essay@work");
    expect(keys).not.toContain("task-t9@mios");
    // Matched by title and time too, not only by link.
    const sameAsTask = ev("plan@life", "life", { title: "Plan week", start: "2026-11-06T15:00:00.000Z", end: "2026-11-06T15:30:00.000Z" });
    expect(exportableEvents([sameAsTask], sources, tasks, ["life"])).toEqual([]);
  });

  it("the same item in two chosen calendars goes out once", () => {
    const copy = ev("standup-copy@life", "life", { title: "standup ", start: standup.start, end: standup.end });
    expect(exportableEvents([standup, copy], sources, [], ["work", "life"]).map((e) => e.key)).toEqual(["standup@work"]);
  });
});

describe("writing calendar items", () => {
  const picked = exportableEvents(all, sources, tasks, ["work", "life"]);
  const names = new Map(sources.map((c) => [c.id, c.name]));
  const { ics, count } = buildIcs(tasks, settings, { includeDeadlines: false, events: picked, calendarNames: names }, now);

  it("counts tasks and items together", () => {
    expect(picked).toHaveLength(5);
    expect(count).toBe(1 + 5);
  });

  it("one-offs keep their id; each repeat occurrence is its own event; details carry over", () => {
    expect(ics).toContain("UID:standup@work\r\n");
    expect(ics).toContain("UID:gym@life_R20261109T180000Z\r\n");
    expect(ics).toContain("UID:gym@life_R20261116T180000Z\r\n");
    expect(ics).toContain("DTSTART:20261117T180000Z\r\n");
    expect(ics).toContain("LOCATION:Room 2\\, floor 3\r\n");
    expect(ics).toContain("CATEGORIES:Work\r\n");
    expect(ics).toContain("TRANSP:TRANSPARENT\r\n");
    expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}\r\nDTEND;VALUE=DATE:\d{8}/);
    expect(ics).not.toContain("RECURRENCE-ID");
  });

  it("read back into MiOS, every item is recognised as the one already there", () => {
    const back = parseIcs(ics, "again", now).events;
    const items = back.filter((e) => !e.miosTaskId);
    expect(items.map((e) => e.key).sort()).toEqual(picked.map((e) => e.key).sort());
    expect(items.find((e) => e.key === gymMoved.key)).toMatchObject({ uid: "gym@life", recurring: true, start: gymMoved.start });
    expect(items.find((e) => e.key === holiday.key)).toMatchObject({ allDay: true, free: true });
    const { report } = mergeEvents(all, back, tasks, now);
    expect(report.added).toBe(0);
  });
});

describe("odd ids", () => {
  it("a UID with a pipe in it is kept whole, and never breaks the export", () => {
    const odd = ev("a|b@x", "work", { recurring: false, title: "Odd" });
    const odder = ev("a|b@x|2026-11-09T18:00:00.000Z", "work", {
      title: "Odder",
      start: "2026-11-09T18:00:00.000Z",
      end: "2026-11-09T19:00:00.000Z",
    });
    const { ics } = buildIcs([], settings, { includeDeadlines: false, events: [odd, odder] }, now);
    expect(ics).toContain("UID:a|b@x\r\n");
    expect(ics).toContain("UID:a|b@x_R20261109T180000Z\r\n");
    const back = parseIcs(ics, "again", now).events;
    expect(back.map((e) => [e.key, e.uid, e.recurring])).toEqual([
      ["a|b@x", "a|b@x", false],
      ["a|b@x|2026-11-09T18:00:00.000Z", "a|b@x", true],
    ]);
  });
});

describe("re-importing an export in the store", () => {
  beforeEach(() => useMios.getState().reset());

  it("adds nothing and leaves no empty calendar behind", () => {
    const st = () => useMios.getState();
    st().importCalendar({ fileName: "work.ics", name: "Work", events: [standup] });
    st().importCalendar({ fileName: "life.ics", name: "Life", events: [gymMon, holiday] });
    const picked = exportableEvents(st().calendarEvents, st().calendarSources, st().tasks, st().calendarSources.map((c) => c.id));
    const { ics } = buildIcs(st().tasks, settings, { includeDeadlines: true, events: picked }, now);
    const parsed = parseIcs(ics, "import", now);
    const report = st().importCalendar({ fileName: "mios-2026-11-05.ics", name: parsed.name, events: parsed.events });
    expect(report.added).toBe(0);
    expect(st().calendarEvents).toHaveLength(3);
    expect(st().calendarSources.map((c) => c.name)).toEqual(["Work", "Life"]);
  });
});
