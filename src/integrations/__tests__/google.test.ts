import { describe, expect, it } from "vitest";
import { mergeEvents } from "@/core";
import { makeTask, NOW } from "@/core/__tests__/fixtures";
import { parseIcs } from "../ics";
import {
  desiredEvents,
  fromGoogle,
  GOOGLE_SOURCE,
  googleEventId,
  planPull,
  planPush,
  type GEvent,
  type GoogleLink,
} from "../google/mapping";

const settings = { defaultEstimateMinutes: 30 };
const now = Date.parse(NOW);

describe("reading Google events", () => {
  it("maps timed, all-day, free and repeating events", () => {
    const timed = fromGoogle(
      { id: "g1", iCalUID: "u1@google.com", summary: "Standup", start: { dateTime: "2026-11-05T09:00:00-05:00" }, end: { dateTime: "2026-11-05T09:15:00-05:00" } },
      GOOGLE_SOURCE.primary,
    )!;
    expect(timed).toMatchObject({ key: "u1@google.com", start: "2026-11-05T14:00:00.000Z", allDay: false, externalId: "g1", recurring: false });

    const allDay = fromGoogle({ id: "g2", summary: "Holiday", start: { date: "2026-11-07" }, end: { date: "2026-11-08" }, transparency: "transparent" }, GOOGLE_SOURCE.primary)!;
    expect(allDay.allDay).toBe(true);
    expect(allDay.free).toBe(true);
    expect(allDay.start).toBe(new Date(2026, 10, 7).toISOString());

    const instance = fromGoogle(
      { id: "r_20261105T150000Z", iCalUID: "r@google.com", recurringEventId: "r", originalStartTime: { dateTime: "2026-11-05T15:00:00Z" }, summary: "Biology", start: { dateTime: "2026-11-05T15:00:00Z" }, end: { dateTime: "2026-11-05T16:00:00Z" } },
      GOOGLE_SOURCE.primary,
    )!;
    expect(instance).toMatchObject({ key: "r@google.com|2026-11-05T15:00:00.000Z", uid: "r@google.com", recurring: true });
  });

  it("drops cancelled events", () => {
    expect(fromGoogle({ id: "x", status: "cancelled" }, GOOGLE_SOURCE.primary)).toBeNull();
  });

  it("a calendar imported as a file and then synced is still one item per event", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:r@google.com",
      "DTSTART:20261105T150000Z",
      "DTEND:20261105T160000Z",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "SUMMARY:Biology",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const fromFile = mergeEvents([], parseIcs(ics, "file", now).events, [], now).events;
    const synced: GEvent[] = [0, 7, 14].map((d) => {
      const start = new Date(Date.UTC(2026, 10, 5 + d, 15)).toISOString();
      return {
        id: `r_${d}`,
        iCalUID: "r@google.com",
        recurringEventId: "r",
        originalStartTime: { dateTime: start },
        summary: "Biology",
        start: { dateTime: start },
        end: { dateTime: new Date(Date.parse(start) + 3_600_000).toISOString() },
      };
    });
    const r = mergeEvents(fromFile, synced.map((g) => fromGoogle(g, GOOGLE_SOURCE.primary)!), [], now);
    expect(r.report.added).toBe(0);
    expect(r.events).toHaveLength(3);
  });
});

describe("what MiOS writes", () => {
  const planned = makeTask({ id: "2f1c9a40-aaaa-bbbb-cccc-0123456789ab", title: "Write cover letter", scheduledStart: "2026-11-06T14:00:00.000Z", estimateMinutes: 45, deadline: "2026-11-07T17:00:00.000Z" });
  const fromCalendar = makeTask({ id: "fromcal", title: "Gym", scheduledStart: "2026-11-06T18:00:00.000Z", source: { kind: "calendar", eventKey: "gym", uid: "gym" } });
  const done = makeTask({ id: "done", state: "done", scheduledStart: "2026-11-01T10:00:00.000Z" });

  it("event ids are stable, valid Google ids", () => {
    const id = googleEventId("block", planned.id);
    expect(id).toBe(googleEventId("block", planned.id));
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(googleEventId("due", planned.id)).not.toBe(id);
  });

  it("writes blocks and deadlines for MiOS's own unfinished tasks only", () => {
    const d = desiredEvents([planned, fromCalendar, done], settings);
    expect(d.map((x) => [x.kind, x.body.summary])).toEqual([
      ["block", "Write cover letter"],
      ["due", "Due: Write cover letter"],
    ]);
    expect(d[0].body.end.dateTime).toBe("2026-11-06T14:45:00.000Z");
    expect(d[0].body.extendedProperties.private).toEqual({ miosTaskId: planned.id, miosKind: "block" });
  });

  it("only sends what changed, and nothing twice", () => {
    const d = desiredEvents([planned], settings);
    const first = planPush(d, {}, [planned]);
    expect(first.upserts).toHaveLength(2);
    const links: Record<string, GoogleLink> = Object.fromEntries(d.map((x) => [x.id, { taskId: x.taskId, kind: x.kind, hash: x.hash }]));
    expect(planPush(d, links, [planned])).toEqual({ upserts: [], deletes: [], forget: [] });

    const moved = { ...planned, scheduledStart: "2026-11-06T15:00:00.000Z" };
    const again = planPush(desiredEvents([moved], settings), links, [moved]);
    expect(again.upserts.map((x) => x.kind)).toEqual(["block"]);
  });

  it("removes events for deleted tasks and cleared plans, but keeps finished tasks' history", () => {
    const d = desiredEvents([planned], settings);
    const links: Record<string, GoogleLink> = Object.fromEntries(d.map((x) => [x.id, { taskId: x.taskId, kind: x.kind, hash: x.hash }]));
    expect(planPush([], links, []).deletes).toHaveLength(2);
    const finished = { ...planned, state: "done" as const };
    expect(planPush(desiredEvents([finished], settings), links, [finished]).forget).toHaveLength(2);
  });

  it("a Due marker the user deleted in Google stays deleted until the deadline changes", () => {
    const d = desiredEvents([planned], settings);
    const due = d.find((x) => x.kind === "due")!;
    const links = { [due.id]: { taskId: planned.id, kind: "due" as const, hash: due.hash, deletedInGoogle: true } };
    expect(planPush([due], links, [planned]).upserts).toEqual([]);
    const later = { ...planned, deadline: "2026-11-08T17:00:00.000Z" };
    expect(planPush(desiredEvents([later], settings), links, [later]).upserts.map((x) => x.kind)).toContain("due");
  });
});

describe("what comes back from the MiOS calendar", () => {
  const task = makeTask({ id: "t-a", title: "Study", scheduledStart: "2026-11-06T14:00:00.000Z" });
  const blockId = googleEventId("block", task.id);
  const dueId = googleEventId("due", task.id);
  const links: Record<string, GoogleLink> = {
    [blockId]: { taskId: task.id, kind: "block", hash: "h" },
    [dueId]: { taskId: task.id, kind: "due", hash: "h" },
  };

  it("moving a block in Google moves the task; our own echo moves nothing", () => {
    const moved = planPull([{ id: blockId, start: { dateTime: "2026-11-06T16:00:00Z" } }], links, [task]);
    expect(moved.moves).toEqual([{ taskId: task.id, start: "2026-11-06T16:00:00.000Z" }]);
    const echo = planPull([{ id: blockId, start: { dateTime: "2026-11-06T14:00:00Z" } }], links, [task]);
    expect(echo.moves).toEqual([]);
  });

  it("deleting a block clears the plan; deleting a Due marker leaves the deadline", () => {
    const r = planPull([{ id: blockId, status: "cancelled" }, { id: dueId, status: "cancelled" }], links, [task]);
    expect(r.cleared).toEqual([task.id]);
    expect(r.dueDeleted).toEqual([dueId]);
  });

  it("re-adopts MiOS events this browser forgot, instead of writing copies", () => {
    const g: GEvent = {
      id: blockId,
      summary: "Study",
      start: { dateTime: "2026-11-06T14:00:00.000Z" },
      end: { dateTime: "2026-11-06T14:30:00.000Z" },
      extendedProperties: { private: { miosTaskId: task.id, miosKind: "block" } },
    };
    const r = planPull([g], {}, [task]);
    expect(Object.keys(r.adopt)).toEqual([blockId]);
    const desired = desiredEvents([task], settings).filter((x) => x.kind === "block");
    expect(planPush(desired, r.adopt, [task]).upserts).toEqual([]);
  });

  it("events the user made in the MiOS calendar are ordinary calendar items", () => {
    const r = planPull([{ id: "own", summary: "Dentist", start: { dateTime: "2026-11-06T09:00:00Z" } }], links, [task]);
    expect(r.others.map((g) => g.id)).toEqual(["own"]);
  });
});
