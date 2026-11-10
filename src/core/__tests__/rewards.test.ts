import { describe, expect, it } from "vitest";
import type { MiosEvent } from "../events";
import { buildWrap, complimentFacts, type WrapInput } from "../wrap";
import { computeStreak, dayKey, dueRewards, periodStats, recordsOn, weekStart } from "../rewards";

// Local-time helpers so tests pass in any time zone.
const at = (month: number, day: number, h = 10) => new Date(2026, month - 1, day, h).getTime();
const done = (t: number, onTime: boolean | null = true): MiosEvent => ({
  type: "task_completed", at: new Date(t).toISOString(), stage: "child", taskId: `t${t}`, onTime, ownChoice: true,
});
const decide = (t: number, usedAi = false): MiosEvent => ({
  type: "decision_made", at: new Date(t).toISOString(), stage: "child", usedAi, feature: "order",
});
/** One finished task on each listed day of November 2026. */
const daysOfNov = (...days: number[]) => days.map((d) => done(at(11, d)));

describe("streak (D5)", () => {
  it("counts consecutive active days and keeps the longest", () => {
    const s = computeStreak([...daysOfNov(1, 2, 3), ...daysOfNov(6, 7)], at(11, 7, 20));
    expect(s.current).toBe(2);
    expect(s.longest).toBe(3);
  });

  it("a decision alone counts for the day", () => {
    expect(computeStreak([decide(at(11, 1)), decide(at(11, 2))], at(11, 2, 20)).current).toBe(2);
  });

  it("today without activity yet doesn't break the streak", () => {
    const s = computeStreak(daysOfNov(1, 2, 3), at(11, 4, 9));
    expect(s.current).toBe(3);
    expect(s.activeToday).toBe(false);
  });

  it("a missed day with no freeze resets the streak", () => {
    expect(computeStreak(daysOfNov(1, 2, 3), at(11, 5, 9)).current).toBe(0);
  });
});

describe("streak freeze (D6)", () => {
  it("earns a freeze every 7 days and spends it on a missed day", () => {
    const events = [...daysOfNov(1, 2, 3, 4, 5, 6, 7), ...daysOfNov(9)];
    const s = computeStreak(events, at(11, 9, 20));
    expect(s.current).toBe(8);
    expect(s.frozenDays).toEqual([dayKey(at(11, 8))]);
    expect(s.freezes).toBe(0);
  });

  it("holds at most 2 freezes", () => {
    const events = daysOfNov(...Array.from({ length: 28 }, (_, i) => i + 1));
    expect(computeStreak(events, at(11, 28, 20)).freezes).toBe(2);
  });
});

describe("period stats and records", () => {
  it("counts tasks, deadlines, and decisions with and without AI", () => {
    const s = periodStats([done(at(11, 2), true), done(at(11, 2), false), done(at(11, 3), null), decide(at(11, 3)), decide(at(11, 3), true), done(at(11, 20))], at(11, 1, 0), at(11, 8, 0));
    expect(s).toMatchObject({ tasksDone: 3, onTime: { hits: 1, total: 2 }, noDeadlineDone: 1, decisions: 2, decisionsNoAi: 1, activeDays: 2 });
  });

  it("needs real history and a real number before calling something a record", () => {
    const prior = [done(at(11, 1)), done(at(11, 2)), done(at(11, 2)), done(at(11, 3))];
    const today = [done(at(11, 4)), done(at(11, 4)), done(at(11, 4))];
    expect(recordsOn([...prior, ...today], dayKey(at(11, 4)))).toEqual([
      { kind: "tasksInDay", day: dayKey(at(11, 4)), value: 3, previousBest: 2 },
    ]);
    // Only two earlier days: not enough history yet.
    expect(recordsOn([done(at(11, 2)), done(at(11, 3)), ...today], dayKey(at(11, 4)))).toEqual([]);
  });
});

describe("when a stats drop is due (D2)", () => {
  it("offers last week's wrap once, only if that week had activity", () => {
    const now = at(11, 10, 9); // Tuesday Nov 10
    const lastWeek = weekStart(now) - 7 * 86_400_000;
    const events = [done(lastWeek + 86_400_000)];
    const due = dueRewards(events, now, {});
    expect(due.map((d) => d.kind)).toContain("weekly");
    const key = due.find((d) => d.kind === "weekly")!.key;
    expect(dueRewards(events, now, { [key]: true }).some((d) => d.kind === "weekly")).toBe(false);
    expect(dueRewards([], now, {}).some((d) => d.kind === "weekly")).toBe(false);
  });

  it("celebrates a streak mark once per run, and stage-ups only when automatic", () => {
    const events: MiosEvent[] = [
      ...daysOfNov(1, 2, 3),
      { type: "stage_changed", at: new Date(at(11, 3)).toISOString(), stage: "child", from: "child", to: "teen", reason: "auto" },
      { type: "stage_changed", at: new Date(at(11, 3, 11)).toISOString(), stage: "teen", from: "teen", to: "adult", reason: "manual" },
    ];
    const due = dueRewards(events, at(11, 3, 20), {});
    expect(due.filter((d) => d.kind === "milestone").map((d) => d.headline)).toEqual(["You reached teen stage", "3 days in a row"]);
  });

  it("never fires per task", () => {
    expect(dueRewards([done(at(11, 3))], at(11, 3, 20), {})).toEqual([]);
  });
});

describe("the wrap (D1, D3, D4)", () => {
  const base = (over: Partial<WrapInput> = {}): WrapInput => {
    const from = at(11, 2, 0);
    const to = at(11, 9, 0);
    const events = [done(at(11, 2)), done(at(11, 3), false), decide(at(11, 3)), decide(at(11, 4)), decide(at(11, 4), true)];
    return {
      reward: { key: "week:x", kind: "weekly", headline: "Your week", from, to },
      stats: periodStats(events, from, to),
      previous: periodStats([decide(at(10, 28))], from - 7 * 86_400_000, from),
      streak: computeStreak(events, at(11, 4, 20)),
      levels: null,
      previousLevels: null,
      now: at(11, 9, 9),
      ...over,
    };
  };

  it("opens and closes with compliments built from real numbers", () => {
    const wrap = buildWrap(base());
    expect(wrap.cards[0].tone).toBe("compliment");
    expect(wrap.cards.at(-1)!.tone).toBe("compliment");
    expect(wrap.cards[0].headline).toBe("You made 2 decisions without AI, 1 more than the week before.");
    for (const c of wrap.cards.filter((x) => x.tone === "compliment")) expect(c.headline).toMatch(/\d/);
  });

  it("weights thinking without AI highest", () => {
    const facts = complimentFacts(base());
    expect(facts[0].text).toContain("without AI");
    const stats = buildWrap(base()).cards.filter((c) => c.tone === "stat");
    expect(stats[0].eyebrow).toBe("Decisions without AI");
  });

  it("doesn't praise a weak deadline record", () => {
    // 1 of 2 deadlines beaten: true, but not worth a compliment.
    const facts = complimentFacts(base()).map((f) => f.text);
    expect(facts.some((t) => t.includes("deadline"))).toBe(false);
  });

  it("always closes with a compliment, even in a quiet week", () => {
    const from = at(11, 2, 0);
    const to = at(11, 9, 0);
    const quiet = [decide(at(11, 4))];
    const wrap = buildWrap({ ...base(), stats: periodStats(quiet, from, to), streak: computeStreak(quiet, at(11, 9, 9)) });
    expect(wrap.cards[0].headline).toBe("You made 1 decision without AI.");
    expect(wrap.cards.at(-1)).toMatchObject({ tone: "compliment", headline: "You showed up on 1 day this week." });
  });

  it("one stat per card, no duplicate cards", () => {
    const ids = buildWrap(base()).cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
