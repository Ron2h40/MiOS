import { describe, expect, it } from "vitest";
import { freeTimeToday, type AgendaItem } from "@/core";

const at = (h: number, m = 0) => new Date(2026, 10, 25, h, m).getTime();
const item = (kind: AgendaItem["kind"], from: number, to: number | undefined, title: string, extra: Partial<AgendaItem> = {}): AgendaItem => ({
  id: `${kind}-${title}`,
  day: "2026-11-25",
  kind,
  title,
  start: from,
  ...(to !== undefined ? { end: to } : {}),
  ...extra,
});

describe("free time today", () => {
  it("finds the gaps from now until midnight", () => {
    const r = freeTimeToday([item("busy", at(11), at(12), "Stand-up"), item("task", at(14), at(15), "Report", { taskId: "t1" })], [], at(10));
    expect(r.slots.map((x) => [x.kind, new Date(x.start).getHours(), new Date(x.end).getHours()])).toEqual([
      ["free", 10, 11],
      ["busy", 11, 12],
      ["free", 12, 14],
      ["task", 14, 15],
      ["free", 15, 0],
    ]);
    expect(r.freeMinutes).toBe(60 + 120 + 9 * 60);
  });

  it("ignores deadlines, all-day and free calendar items, and anything already over", () => {
    const r = freeTimeToday(
      [
        item("due", at(13), undefined, "Deadline"),
        item("free", at(0), at(23, 59), "Holiday", { allDay: true }),
        item("busy", at(8), at(9), "Earlier meeting"),
      ],
      [],
      at(22),
    );
    expect(r.slots).toHaveLength(1);
    expect(r.freeMinutes).toBe(120);
  });

  it("counts protected time as taken, cut off at midnight", () => {
    const r = freeTimeToday([], [{ id: "s", label: "Sleep", days: [], start: "23:00", end: "07:00" }], at(21));
    expect(r.slots.map((x) => x.kind)).toEqual(["free", "protected"]);
    expect(r.slots[1].end).toBe(new Date(2026, 10, 26).getTime());
    expect(r.freeMinutes).toBe(120);
  });

  it("skips gaps shorter than 15 minutes and handles overlaps", () => {
    const r = freeTimeToday(
      [item("busy", at(10, 10), at(11), "A"), item("busy", at(10, 30), at(11, 30), "B"), item("busy", at(11, 40), at(12), "C")],
      [],
      at(10),
    );
    expect(r.slots.map((x) => x.title)).toEqual(["A", "B", "C", "Free"]);
  });
});
