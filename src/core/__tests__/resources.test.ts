import { describe, expect, it } from "vitest";
import type { MiosEvent } from "../events";
import { PRESETS_BY_ID, RESOURCE_PRESETS } from "../resourcePresets";
import {
  activeEffects,
  chartTime,
  curveAt,
  daySeries,
  levelsAt,
  runningIntervals,
  type ResourceEntry,
  type ResourceInputs,
} from "../resources";

const H = 3_600_000;
const T0 = new Date(2026, 10, 5, 8, 0).getTime(); // 8:00 local
const iso = (ms: number) => new Date(ms).toISOString();
const entry = (itemId: string, at: number, hours?: number): ResourceEntry => ({ id: `${itemId}@${at}`, itemId, at: iso(at), hours });
const input = (entries: ResourceEntry[], over: Partial<ResourceInputs> = {}): ResourceInputs => ({
  entries,
  items: PRESETS_BY_ID,
  tolerances: {},
  intervals: [],
  ...over,
});

describe("effect curves", () => {
  it("interpolates between shape points and is zero outside", () => {
    const shape = [[0, 0], [2, 1], [4, 0]] as const;
    expect(curveAt(shape, -1)).toBe(0);
    expect(curveAt(shape, 1)).toBe(0.5);
    expect(curveAt(shape, 2)).toBe(1);
    expect(curveAt(shape, 3)).toBe(0.5);
    expect(curveAt(shape, 5)).toBe(0);
  });

  it("stretches in time with the duration tolerance", () => {
    const shape = [[0, 0], [2, 1], [4, 0]] as const;
    expect(curveAt(shape, 4, 2)).toBe(1);
  });

  it("every preset starts at zero, ends at zero, and runs forward in time", () => {
    for (const p of RESOURCE_PRESETS.filter((x) => x.kind !== "sleep")) {
      expect(p.shape[0]).toEqual([0, 0]);
      expect(p.shape.at(-1)![1]).toBe(0);
      for (let i = 1; i < p.shape.length; i++) expect(p.shape[i][0]).toBeGreaterThan(p.shape[i - 1][0]);
    }
  });

  it("every medicine peaks where its label says, and cites a source for label facts", () => {
    for (const p of RESOURCE_PRESETS.filter((x) => x.kind === "medicine")) {
      const peakAt = p.shape.reduce((best, s) => (s[1] > best[1] ? s : best))[0];
      expect(curveAt(p.shape, peakAt)).toBe(1);
      for (const fact of Object.values(p.facts ?? {})) {
        if (fact.basis === "label") expect(fact.source?.url).toMatch(/^https:\/\/dailymed\.nlm\.nih\.gov\//);
        if (fact.basis === "estimate") expect(fact.note).toBeTruthy();
      }
    }
    // Spot-check: peaks match the labels' Tmax.
    expect(curveAt(PRESETS_BY_ID.get("methylphenidate-ir")!.shape, 2)).toBe(1);
    expect(curveAt(PRESETS_BY_ID.get("amphetamine-ir")!.shape, 3)).toBe(1);
    expect(curveAt(PRESETS_BY_ID.get("amphetamine-xr")!.shape, 7)).toBe(1);
  });
});

describe("resource levels", () => {
  it("adds up active items and applies personal tolerance", () => {
    const e = [entry("coffee", T0)];
    expect(levelsAt(input(e), T0 + 1 * H).focus).toBe(20);
    expect(levelsAt(input(e, { tolerances: { coffee: { strength: 0.5, duration: 1 } } }), T0 + 1 * H).focus).toBe(10);
  });

  it("caps at 100 and never goes below 0", () => {
    const e = Array.from({ length: 10 }, (_, i) => entry("water", T0 + i));
    expect(levelsAt(input(e), T0 + 0.25 * H).hydration).toBe(100);
    expect(levelsAt(input([]), T0).focus).toBe(0);
  });

  it("uses the latest sleep as the day's baseline, scaled by hours slept", () => {
    const full = levelsAt(input([entry("sleep", T0, 8)]), T0);
    const short = levelsAt(input([entry("sleep", T0, 4)]), T0);
    expect(full.energy).toBe(70);
    expect(short.energy).toBe(35);
    // Drains over the waking day.
    expect(levelsAt(input([entry("sleep", T0, 8)]), T0 + 8.5 * H).energy).toBe(35);
  });

  it("C5: running tasks drain focus and energy", () => {
    const e = [entry("sleep", T0, 8)];
    const intervals = [{ start: T0, end: T0 + 2 * H }];
    const rested = levelsAt(input(e), T0 + 2 * H);
    const worked = levelsAt(input(e, { intervals }), T0 + 2 * H);
    expect(rested.focus - worked.focus).toBe(16);
    expect(rested.energy - worked.energy).toBe(12);
  });

  it("rebuilds running intervals from task state events", () => {
    const ev = (to: string, from: string, at: number) =>
      ({ type: "task_state_changed", at: iso(at), stage: "child", taskId: "t", from, to }) as MiosEvent;
    const intervals = runningIntervals([ev("running", "ready", T0), ev("ready", "running", T0 + H), ev("running", "ready", T0 + 2 * H)], T0 + 3 * H);
    expect(intervals).toEqual([
      { start: T0, end: T0 + H },
      { start: T0 + 2 * H, end: T0 + 3 * H },
    ]);
  });

  it("lists what's still working, longest first", () => {
    const e = [entry("snack", T0), entry("coffee", T0)];
    const active = activeEffects(input(e), T0 + 1 * H);
    expect(active.map((a) => a.item.id)).toEqual(["coffee", "snack"]);
    expect(active[0].hoursLeft).toBe(12);
  });

  it("builds a full-day series", () => {
    const day = new Date(2026, 10, 5).getTime();
    const s = daySeries(input([entry("coffee", T0)]), day, 60);
    expect(s).toHaveLength(25);
    expect(s[9].focus).toBe(20); // 9:00, one hour after the coffee
  });
});

describe("chartTime", () => {
  const clock = Date.parse("2026-11-23T10:00:00.000Z");
  const at = (s: number) => new Date(clock + s * 1000).toISOString();
  const logged = (s: number): ResourceEntry => ({ id: `e${s}`, itemId: "coffee", at: at(s) });
  const started = (s: number): MiosEvent => ({ type: "task_state_changed", at: at(s), stage: "child", taskId: "t", from: "ready", to: "running" });

  it("uses the clock when nothing newer happened", () => {
    expect(chartTime(clock, [logged(-600)], [started(-300)])).toBe(clock);
  });

  it("moves to something logged after the clock last ticked", () => {
    expect(chartTime(clock, [logged(-600), logged(40)], [])).toBe(clock + 40_000);
  });

  it("moves to a task started after the clock last ticked", () => {
    expect(chartTime(clock, [], [started(25)])).toBe(clock + 25_000);
  });
});
