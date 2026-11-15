import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todaysReminders } from "@/core";
import { describeEvent, isB8Trigger } from "@/ai/backgroundLog";
import { exportSnapshot, useMios } from "../store";
import { MIOS_COLLECTIONS } from "../syncCollections";

const st = () => useMios.getState();
const at = (h: number, m = 0) => new Date(2026, 10, 11, h, m);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at(7));
  st().reset();
});
afterEach(() => vi.useRealTimers());

const addVitaminD = () =>
  st().addMed({ name: "  Vitamin D ", doses: [{ id: "am", trigger: { kind: "time", at: "08:00" } }], days: { kind: "daily" }, remind: true });

describe("daily medicines in the store", () => {
  it("logging a due dose settles today's reminder, and undo brings it back", () => {
    const med = addVitaminD();
    expect(med.name).toBe("Vitamin D");
    vi.setSystemTime(at(8, 40));
    expect(todaysReminders(st().meds, st().medLogs, st().resourceEntries, Date.now())[0].state.kind).toBe("due");
    const log = st().takeDose(med.id, "am")!;
    expect(todaysReminders(st().meds, st().medLogs, st().resourceEntries, Date.now())[0].state.kind).toBe("taken");
    st().undoMedLog(log.id);
    expect(todaysReminders(st().meds, st().medLogs, st().resourceEntries, Date.now())[0].state.kind).toBe("due");
  });

  it("habit events say how late, never which medicine; dismissing is logged too", () => {
    const med = addVitaminD();
    vi.setSystemTime(at(8, 40));
    st().takeDose(med.id, "am");
    st().dismissDose(med.id, "am"); // a second answer for the same dose replaces the first
    const events = st().events.filter((e) => e.type === "med_logged" || e.type === "med_dismissed");
    expect(events.map((e) => e.type)).toEqual(["med_logged", "med_dismissed"]);
    expect(events[0]).toMatchObject({ scheduled: true, lateMinutes: 40 });
    expect(st().medLogs).toHaveLength(1);
    expect(st().medLogs[0].status).toBe("dismissed");
    const text = events.map((e) => describeEvent(e, new Map())).join(" ");
    expect(text).toContain("40 min after its time");
    expect(text).not.toMatch(/vitamin d/i);
    expect(events.every(isB8Trigger)).toBe(true);
  });

  it("'taken earlier' records the real time, and on time counts as on time", () => {
    const med = addVitaminD();
    vi.setSystemTime(at(10));
    st().takeDose(med.id, "am", at(7, 55).toISOString());
    expect(st().medLogs[0].at).toBe(at(7, 55).toISOString());
    expect(st().events.at(-1)).toMatchObject({ type: "med_logged", lateMinutes: 0 });
  });

  it("a preset medicine also moves the charts; undo removes that too. A typed-in one never does", () => {
    const ritalin = st().addMed({ name: "Ritalin", presetId: "methylphenidate-ir", doses: [], days: { kind: "daily" }, remind: false });
    const log = st().takeDose(ritalin.id)!;
    expect(st().resourceEntries.map((e) => e.itemId)).toEqual(["methylphenidate-ir"]);
    st().undoMedLog(log.id);
    expect(st().resourceEntries).toHaveLength(0);
    const typed = addVitaminD();
    st().takeDose(typed.id);
    expect(st().resourceEntries).toHaveLength(0);
    expect(st().events.at(-1)).toMatchObject({ scheduled: false, lateMinutes: null });
  });

  it("removing stops reminders but keeps the history; pausing can be undone", () => {
    const med = addVitaminD();
    st().takeDose(med.id, "am");
    st().setMedPaused(med.id, true);
    expect(todaysReminders(st().meds, st().medLogs, st().resourceEntries, Date.now())).toHaveLength(0);
    st().setMedPaused(med.id, false);
    expect(st().meds[0].pausedAt).toBeUndefined();
    st().removeMed(med.id);
    expect(st().meds).toHaveLength(1);
    expect(st().medLogs).toHaveLength(1);
    expect(todaysReminders(st().meds, st().medLogs, st().resourceEntries, Date.now())).toHaveLength(0);
  });

  it("logging later: never in the future, and a fixed time keeps a linked medicine log in step", () => {
    vi.setSystemTime(at(10));
    const future = st().logResource("coffee", { at: at(12).toISOString() });
    expect(future.at).toBe(at(10).toISOString());
    const coffee = st().logResource("coffee", { at: at(8, 30).toISOString() });
    expect(coffee.at).toBe(at(8, 30).toISOString());

    const ritalin = st().addMed({ name: "Ritalin", presetId: "methylphenidate-ir", doses: [], days: { kind: "daily" }, remind: false });
    const log = st().takeDose(ritalin.id, undefined, at(9).toISOString())!;
    st().moveResource(log.entryId!, at(8, 45).toISOString());
    expect(st().resourceEntries.find((e) => e.id === log.entryId)?.at).toBe(at(8, 45).toISOString());
    expect(st().medLogs[0].at).toBe(at(8, 45).toISOString());
    st().moveResource(log.entryId!, at(23).toISOString());
    expect(st().medLogs[0].at).toBe(at(10).toISOString());
  });

  it("medicines sync, export and import with everything else", () => {
    const med = addVitaminD();
    st().takeDose(med.id, "am");
    expect(MIOS_COLLECTIONS.map((c) => c.name)).toEqual(expect.arrayContaining(["meds", "medLogs"]));
    const json = exportSnapshot();
    st().reset();
    st().importData(json);
    expect(st().meds.map((m) => m.name)).toEqual(["Vitamin D"]);
    expect(st().medLogs).toHaveLength(1);
  });
});
