import { beforeEach, describe, expect, it } from "vitest";
import {
  buildAgenda,
  busyIntervals,
  CALENDAR_COLORS,
  fillCalendarColors,
  findProtectedConflicts,
  nextCalendarColor,
  normalizeColor,
  type CalendarEvent,
  type CalendarSource,
} from "@/core";
import { parseIcs } from "@/integrations/ics";
import { exportSnapshot, useMios } from "../store";

const st = () => useMios.getState();
const today = (h: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString();
};
const ev = (key: string, sourceId = "x"): CalendarEvent => ({
  key,
  uid: key,
  recurring: false,
  title: key,
  start: today(9),
  end: today(10),
  allDay: false,
  sourceId,
});
const src = (id: string, color?: string): CalendarSource => ({ id, kind: "ics", name: id, importedAt: today(0), ...(color ? { color } : {}) });

describe("colour rules", () => {
  it("reads #rgb, #rrggbb and #rrggbbaa; ignores names and junk", () => {
    expect(normalizeColor("#F0A")).toBe("#ff00aa");
    expect(normalizeColor("#1BADF8")).toBe("#1badf8");
    expect(normalizeColor("#1BADF8FF")).toBe("#1badf8");
    expect(normalizeColor("turquoise")).toBeUndefined();
    expect(normalizeColor("#12345")).toBeUndefined();
    expect(normalizeColor(undefined)).toBeUndefined();
  });

  it("hands out unused colours first, then goes round", () => {
    expect(nextCalendarColor([])).toBe(CALENDAR_COLORS[0]);
    expect(nextCalendarColor([{ color: CALENDAR_COLORS[0] }, { color: "#123456" }])).toBe(CALENDAR_COLORS[1]);
    const all = CALENDAR_COLORS.map((color) => ({ color }));
    expect(CALENDAR_COLORS).toContain(nextCalendarColor(all));
  });

  it("fills only missing colours, never repeats one while others are free, and leaves MiOS's own calendar alone", () => {
    const filled = fillCalendarColors([src("a"), src("b", CALENDAR_COLORS[0]), { ...src("m"), mios: true }, src("c")]);
    expect(filled.map((c) => c.color)).toEqual([CALENDAR_COLORS[1], CALENDAR_COLORS[0], undefined, CALENDAR_COLORS[2]]);
    const done = [src("a", "#111111")];
    expect(fillCalendarColors(done)).toBe(done);
  });
});

describe("calendar colours in the store", () => {
  beforeEach(() => st().reset());

  it("each new calendar gets its own colour; a file's own colour wins", () => {
    st().importCalendar({ fileName: "a.ics", events: [ev("a1")] });
    st().importCalendar({ fileName: "b.ics", events: [ev("b1")] });
    st().importCalendar({ fileName: "c.ics", color: "#1BADF8", events: [ev("c1")] });
    expect(st().calendarSources.map((c) => c.color)).toEqual([CALENDAR_COLORS[0], CALENDAR_COLORS[1], "#1badf8"]);
  });

  it("a colour the user picked survives re-importing the file", () => {
    st().importCalendar({ fileName: "a.ics", color: "#1badf8", events: [ev("a1")] });
    const id = st().calendarSources[0].id;
    st().setCalendarColor(id, CALENDAR_COLORS[3]);
    st().importCalendar({ fileName: "a.ics", color: "#1badf8", events: [ev("a1")] });
    expect(st().calendarSources[0].color).toBe(CALENDAR_COLORS[3]);
    st().setCalendarColor(id, "not a colour");
    expect(st().calendarSources[0].color).toBe(CALENDAR_COLORS[3]);
  });

  it("Google's main calendar keeps its colour across syncs; MiOS's own Google calendar has none of its own", () => {
    st().applyGoogleItems({ sourceId: "google:primary", name: "Google Calendar", items: [ev("g1")], removedIds: [], full: true });
    st().setCalendarColor("google:primary", CALENDAR_COLORS[4]);
    st().applyGoogleItems({ sourceId: "google:primary", name: "Google Calendar", items: [ev("g1")], removedIds: [], full: true });
    st().applyGoogleItems({ sourceId: "google:mios", name: "MiOS calendar (Google)", mios: true, items: [ev("m1")], removedIds: [], full: true });
    expect(st().calendarSources.find((c) => c.id === "google:primary")?.color).toBe(CALENDAR_COLORS[4]);
    expect(st().calendarSources.find((c) => c.id === "google:mios")).toMatchObject({ mios: true });
    expect(st().calendarSources.find((c) => c.id === "google:mios")?.color).toBeUndefined();
  });

  it("calendars saved before colours existed get one on the daily run and on data import", () => {
    useMios.setState({ calendarSources: [src("old1"), src("old2")] });
    st().runDaily();
    expect(st().calendarSources.map((c) => c.color)).toEqual([CALENDAR_COLORS[0], CALENDAR_COLORS[1]]);

    const json = JSON.parse(exportSnapshot());
    json.calendarSources = [src("old3")];
    st().reset();
    expect(st().importData(JSON.stringify(json)).ok).toBe(true);
    expect(st().calendarSources[0].color).toBe(CALENDAR_COLORS[0]);
  });

  it("export and import keep the colours", () => {
    st().importCalendar({ fileName: "a.ics", color: "#1badf8", events: [ev("a1")] });
    const json = exportSnapshot();
    st().reset();
    st().importData(json);
    expect(st().calendarSources[0].color).toBe("#1badf8");
  });
});

describe("where the calendar shows", () => {
  it("agenda items from a calendar carry it; MiOS's own items don't", () => {
    const e = ev("shift", "work");
    const agenda = buildAgenda(
      {
        tasks: [{ ...st().addTask({ title: "Essay", mode: "daily-life", priority: 3, scheduledStart: today(13) }) }],
        events: [e],
        decisions: {},
        repeats: [],
        defaultEstimateMinutes: 30,
      },
      new Date(),
      1,
      Date.now(),
    );
    const items = [...agenda.values()][0];
    expect(items.find((i) => i.title === "shift")?.sourceId).toBe("work");
    expect(items.find((i) => i.title === "Essay")?.sourceId).toBeUndefined();
  });

  it("busy-time clashes name the calendar", () => {
    const busy = busyIntervals([ev("Gym", "life")], {}, [], [{ id: "life", name: "Life" }]);
    expect(busy[0]).toMatchObject({ label: "Gym", calendar: "Life" });
    expect(findProtectedConflicts(today(9), 30, [], busy)[0]).toMatchObject({ kind: "calendar", label: "Gym", calendar: "Life" });
    expect(busyIntervals([ev("Gym", "gone")], {}, [])[0].calendar).toBeUndefined();
  });

  it("reads an Apple calendar file's colour", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Apple//EN",
      "X-WR-CALNAME:Work",
      "X-APPLE-CALENDAR-COLOR:#CC73E1FF",
      "BEGIN:VEVENT",
      "UID:w1",
      `DTSTART:${today(9).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`,
      `DTEND:${today(10).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`,
      "SUMMARY:Standup",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsed = parseIcs(ics, "import", Date.now());
    expect(parsed).toMatchObject({ name: "Work", color: "#cc73e1" });
    expect(parseIcs(ics.replace("X-APPLE-CALENDAR-COLOR:#CC73E1FF\r\n", ""), "import", Date.now()).color).toBeUndefined();
  });
});
