import { describe, expect, it } from "vitest";
import { busyIntervals, calendarStatus, mergeEvents, miosUid, type CalendarEvent } from "@/core";
import { makeTask, NOW } from "@/core/__tests__/fixtures";
import { buildIcs, parseIcs } from "../ics";

const now = Date.parse(NOW); // 2026-11-05T12:00Z

const cal = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN", "X-WR-CALNAME:School", ...events, "END:VCALENDAR"].join("\r\n");

const vevent = (props: Record<string, string>) =>
  ["BEGIN:VEVENT", ...Object.entries(props).map(([k, v]) => `${k}:${v}`), "END:VEVENT"].join("\r\n");

const CLASS = vevent({
  UID: "class-1@school",
  DTSTART: "20261102T150000Z",
  DTEND: "20261102T163000Z",
  SUMMARY: "Biology",
  LOCATION: "Room 4",
  RRULE: "FREQ=WEEKLY;COUNT=6",
  EXDATE: "20261116T150000Z",
});
const CLASS_MOVED = vevent({
  UID: "class-1@school",
  "RECURRENCE-ID": "20261109T150000Z",
  DTSTART: "20261109T170000Z",
  DTEND: "20261109T183000Z",
  SUMMARY: "Biology (moved)",
});
const DENTIST = vevent({ UID: "dentist@me", DTSTART: "20261105T140000Z", DTEND: "20261105T150000Z", SUMMARY: "Dentist" });
const CANCELLED = vevent({ UID: "gone@me", DTSTART: "20261106T140000Z", DTEND: "20261106T150000Z", SUMMARY: "Gone", STATUS: "CANCELLED" });
const BIRTHDAY = vevent({ UID: "bday@me", "DTSTART;VALUE=DATE": "20261107", "DTEND;VALUE=DATE": "20261108", SUMMARY: "Mum's birthday", TRANSP: "TRANSPARENT" });
const NO_UID = vevent({ DTSTART: "20261108T090000Z", DTEND: "20261108T100000Z", SUMMARY: "Run" });

const SCHOOL = cal(CLASS, CLASS_MOVED, DENTIST, CANCELLED, BIRTHDAY, NO_UID);

describe("parseIcs", () => {
  const { name, events } = parseIcs(SCHOOL, "src", now);

  it("reads the calendar name, one-offs and all-day items", () => {
    expect(name).toBe("School");
    const dentist = events.find((e) => e.uid === "dentist@me")!;
    expect(dentist).toMatchObject({ key: "dentist@me", title: "Dentist", start: "2026-11-05T14:00:00.000Z", allDay: false, recurring: false });
    const bday = events.find((e) => e.uid === "bday@me")!;
    expect(bday.allDay).toBe(true);
    expect(bday.free).toBe(true);
  });

  it("expands repeats, skips EXDATEs and applies edited occurrences", () => {
    const bio = events.filter((e) => e.uid === "class-1@school");
    expect(bio).toHaveLength(5); // 6 weeks minus one EXDATE
    expect(new Set(bio.map((e) => e.key)).size).toBe(5);
    const moved = bio.find((e) => e.key === "class-1@school|2026-11-09T15:00:00.000Z")!;
    expect(moved.title).toBe("Biology (moved)");
    expect(moved.start).toBe("2026-11-09T17:00:00.000Z");
    expect(bio.every((e) => e.recurring)).toBe(true);
  });

  it("drops cancelled events", () => {
    expect(events.some((e) => e.uid === "gone@me")).toBe(false);
  });

  it("gives UID-less events the same made-up id every time", () => {
    const again = parseIcs(SCHOOL, "src", now).events.find((e) => e.title === "Run")!;
    const first = events.find((e) => e.title === "Run")!;
    expect(first.uid).toMatch(/^nouid-/);
    expect(again.key).toBe(first.key);
  });
});

describe("no duplicates, ever", () => {
  const school = () => parseIcs(SCHOOL, "src", now).events;

  it("importing the same file 100 times changes nothing after the first", () => {
    let stored: CalendarEvent[] = [];
    const first = mergeEvents(stored, school(), [], now);
    stored = first.events;
    expect(first.report.added).toBe(stored.length);
    for (let i = 0; i < 100; i++) {
      const r = mergeEvents(stored, school(), [], now);
      expect(r.report.added).toBe(0);
      expect(r.report.updated).toBe(0);
      stored = r.events;
    }
    expect(stored).toHaveLength(first.events.length);
  });

  it("the same event under a different id (another calendar, rewritten UIDs) is one event", () => {
    const stored = mergeEvents([], school(), [], now).events;
    const copy = parseIcs(SCHOOL.replaceAll("dentist@me", "other-id@outlook"), "src2", now).events;
    const r = mergeEvents(stored, copy, [], now);
    expect(r.report.added).toBe(0);
    expect(r.events.filter((e) => e.title === "Dentist")).toHaveLength(1);
  });

  it("a moved event updates in place", () => {
    const stored = mergeEvents([], school(), [], now).events;
    const moved = parseIcs(SCHOOL.replace("20261105T140000Z", "20261105T160000Z").replace("20261105T150000Z", "20261105T170000Z"), "src", now);
    const r = mergeEvents(stored, moved.events, [], now);
    expect(r.report.updated).toBe(1);
    expect(r.events.filter((e) => e.uid === "dentist@me")).toHaveLength(1);
    expect(r.events.find((e) => e.uid === "dentist@me")!.start).toBe("2026-11-05T16:00:00.000Z");
  });

  it("duplicates inside one file collapse", () => {
    const r = mergeEvents([], parseIcs(cal(DENTIST, DENTIST, DENTIST), "src", now).events, [], now);
    expect(r.events).toHaveLength(1);
  });
});

describe("MiOS's own tasks coming back", () => {
  const essay = makeTask({ id: "essay", title: "Essay; part 1, draft", scheduledStart: "2026-11-06T10:00:00.000Z", estimateMinutes: 90, deadline: "2026-11-08T17:00:00.000Z" });
  const done = makeTask({ id: "old", title: "Old", state: "done", scheduledStart: "2026-11-06T10:00:00.000Z" });
  const tasks = [essay, done];

  it("exports planned blocks and deadlines with stable UIDs, skipping finished tasks", () => {
    const { ics, count } = buildIcs(tasks, { defaultEstimateMinutes: 30 }, { includeDeadlines: true }, now);
    expect(count).toBe(2);
    expect(ics).toContain(`UID:${miosUid.block("essay")}`);
    expect(ics).toContain(`UID:${miosUid.due("essay")}`);
    expect(ics).toContain("SUMMARY:Essay\\; part 1\\, draft");
    expect(ics).toContain("DTEND:20261106T113000Z");
    expect(ics).not.toContain("old@mios");
    expect(buildIcs(tasks, { defaultEstimateMinutes: 30 }, { includeDeadlines: false }, now).count).toBe(1);
  });

  it("re-importing the export adds nothing", () => {
    const { ics } = buildIcs(tasks, { defaultEstimateMinutes: 30 }, { includeDeadlines: true }, now);
    const parsed = parseIcs(ics, "src", now);
    expect(parsed.events.map((e) => e.title)).toEqual(["Essay; part 1, draft", "Due: Essay; part 1, draft"]);
    const r = mergeEvents([], parsed.events, tasks, now);
    expect(r.report.alreadyInMios).toBe(2);
    expect(r.events).toHaveLength(0);
  });

  it("still matched after a round trip through another calendar that drops MiOS's extra field", () => {
    const { ics } = buildIcs(tasks, { defaultEstimateMinutes: 30 }, { includeDeadlines: true }, now);
    const viaGoogle = ics.replace(/X-MIOS-TASK-ID:[^\r\n]*\r\n/g, "");
    const r = mergeEvents([], parseIcs(viaGoogle, "src", now).events, tasks, now);
    expect(r.events).toHaveLength(0);
  });

  it("even with new UIDs, a calendar item matching a task by title and time is that task", () => {
    const { ics } = buildIcs(tasks, { defaultEstimateMinutes: 30 }, { includeDeadlines: true }, now);
    const rewritten = ics.replace(/UID:[^\r\n]*/g, (_, i) => `UID:random-${i}@elsewhere`).replace(/X-MIOS-TASK-ID:[^\r\n]*\r\n/g, "");
    const r = mergeEvents([], parseIcs(rewritten, "src", now).events, tasks, now);
    // Stored (it isn't MiOS-tagged any more) but recognised as the task: never asked, never busy time.
    expect(r.events).toHaveLength(2);
    for (const e of r.events) expect(calendarStatus(e, {}, tasks)).toEqual({ kind: "task", taskId: "essay" });
    expect(busyIntervals(r.events, {}, tasks)).toHaveLength(0);
  });

  it("an exported task whose task was deleted comes back as a normal item", () => {
    const { ics } = buildIcs([essay], { defaultEstimateMinutes: 30 }, { includeDeadlines: false }, now);
    const r = mergeEvents([], parseIcs(ics, "src", now).events, [], now);
    expect(r.events).toHaveLength(1);
    expect(calendarStatus(r.events[0], {}, [])).toEqual({ kind: "pending" });
  });
});

describe("export format", () => {
  it("folds long lines at 75 octets and ends lines with CRLF", () => {
    const long = makeTask({ id: "long", title: "ü".repeat(80), scheduledStart: "2026-11-06T10:00:00.000Z" });
    const { ics } = buildIcs([long], { defaultEstimateMinutes: 30 }, { includeDeadlines: false }, now);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(parseIcs(ics, "src", now).events[0].title).toBe("ü".repeat(80));
  });
});
