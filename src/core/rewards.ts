import type { MiosEvent } from "./events";
import { levelsAt, RESOURCE_KEYS, type ResourceInputs, type ResourceKey } from "./resources";
import type { Stage } from "./types";

/**
 * Section D, rewards: streaks, period stats, personal records, and when a
 * stats drop is due. Everything is derived from the event log, so nothing
 * here can drift out of sync with what the user actually did.
 */

/** Local calendar day, "YYYY-MM-DD". */
export const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const startOfLocalDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const addDays = (ms: number, n: number): number => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

/** Monday 00:00 of the local week containing `ms`. */
export const weekStart = (ms: number): number => {
  const d = new Date(startOfLocalDay(ms));
  return addDays(d.getTime(), -((d.getDay() + 6) % 7));
};

export const monthStart = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/** A day counts toward the streak with at least one finished task or one decision (D5). */
const countsForStreak = (e: MiosEvent) => e.type === "task_completed" || e.type === "decision_made";

export const activeDays = (events: readonly MiosEvent[]): Set<string> =>
  new Set(events.filter(countsForStreak).map((e) => dayKey(Date.parse(e.at))));

// ---------------------------------------------------------------------------
// Streak (D5) with freezes (D6)
// ---------------------------------------------------------------------------

export const STREAK_RULES = {
  /** Earn one freeze for every this many active days in a row. */
  freezeEvery: 7,
  maxFreezes: 2,
} as const;

export const STREAK_MARKS = [3, 7, 14, 30, 50, 100, 200, 365] as const;

export interface StreakState {
  current: number;
  longest: number;
  freezes: number;
  /** First day of the current run (for celebrating each mark once per run). */
  runStart: string | null;
  /** Days a freeze saved the streak. */
  frozenDays: string[];
  /** Today has activity already. */
  activeToday: boolean;
}

/**
 * Walk every day from the first active day to today. Today never breaks the
 * streak (the day isn't over). A missed day uses a freeze if one is held;
 * otherwise the streak resets. The longest streak is always kept.
 */
export const computeStreak = (
  events: readonly MiosEvent[],
  now: number,
  rules: { freezeEvery: number; maxFreezes: number } = STREAK_RULES,
): StreakState => {
  const days = activeDays(events);
  const today = dayKey(now);
  const state: StreakState = { current: 0, longest: 0, freezes: 0, runStart: null, frozenDays: [], activeToday: days.has(today) };
  if (!days.size) return state;

  const first = startOfLocalDay(Date.parse([...events].filter(countsForStreak).sort((a, b) => a.at.localeCompare(b.at))[0].at));
  let earned = 0;
  for (let d = first; dayKey(d) <= today; d = addDays(d, 1)) {
    const key = dayKey(d);
    if (days.has(key)) {
      if (state.current === 0) state.runStart = key;
      state.current++;
      earned++;
      if (earned === rules.freezeEvery) {
        state.freezes = Math.min(rules.maxFreezes, state.freezes + 1);
        earned = 0;
      }
      state.longest = Math.max(state.longest, state.current);
    } else if (key !== today && state.current > 0) {
      if (state.freezes > 0) {
        state.freezes--;
        state.frozenDays.push(key);
      } else {
        state.current = 0;
        state.runStart = null;
        earned = 0;
      }
    }
  }
  return state;
};

// ---------------------------------------------------------------------------
// Period stats (D4)
// ---------------------------------------------------------------------------

export interface PeriodStats {
  from: number;
  to: number;
  tasksDone: number;
  /** Deadline tasks only; no-deadline tasks are their own type. */
  onTime: { hits: number; total: number };
  noDeadlineDone: number;
  decisions: number;
  decisionsNoAi: number;
  deadlocksBroken: number;
  activeDays: number;
}

export const periodStats = (events: readonly MiosEvent[], from: number, to: number): PeriodStats => {
  const s: PeriodStats = {
    from,
    to,
    tasksDone: 0,
    onTime: { hits: 0, total: 0 },
    noDeadlineDone: 0,
    decisions: 0,
    decisionsNoAi: 0,
    deadlocksBroken: 0,
    activeDays: 0,
  };
  const days = new Set<string>();
  for (const e of events) {
    const t = Date.parse(e.at);
    if (t < from || t >= to) continue;
    if (countsForStreak(e)) days.add(dayKey(t));
    if (e.type === "task_completed") {
      s.tasksDone++;
      if (e.onTime === null) s.noDeadlineDone++;
      else {
        s.onTime.total++;
        if (e.onTime) s.onTime.hits++;
      }
    } else if (e.type === "decision_made") {
      s.decisions++;
      if (!e.usedAi) s.decisionsNoAi++;
    } else if (e.type === "deadlock_broken") s.deadlocksBroken++;
  }
  s.activeDays = days.size;
  return s;
};

/** Average resource levels during waking hours (8:00–22:00) on days with logged items, and how many such days. */
export const averageLevels = (
  input: ResourceInputs,
  from: number,
  to: number,
): { levels: Record<ResourceKey, number>; days: number } | null => {
  const sum: Record<ResourceKey, number> = { focus: 0, energy: 0, hydration: 0 };
  let n = 0;
  let days = 0;
  for (let day = startOfLocalDay(from); day < to; day = addDays(day, 1)) {
    const logged = input.entries.some((e) => {
      const t = Date.parse(e.at);
      return t >= day && t < addDays(day, 1);
    });
    if (!logged) continue;
    days++;
    for (let h = 8; h <= 22; h++) {
      const t = day + h * 3_600_000;
      if (t >= to) break;
      const l = levelsAt(input, t);
      for (const k of RESOURCE_KEYS) sum[k] += l[k];
      n++;
    }
  }
  if (!n) return null;
  return {
    levels: { focus: Math.round(sum.focus / n), energy: Math.round(sum.energy / n), hydration: Math.round(sum.hydration / n) },
    days,
  };
};

// ---------------------------------------------------------------------------
// Personal records
// ---------------------------------------------------------------------------

export type RecordKind = "tasksInDay" | "noAiInDay";

export interface PersonalRecord {
  kind: RecordKind;
  day: string;
  value: number;
  previousBest: number;
}

/** Records need a real history behind them, and a value worth celebrating. */
export const RECORD_RULES = { minValue: 3, minPriorDays: 3 } as const;

/** Records set on `day` that beat every earlier day. */
export const recordsOn = (events: readonly MiosEvent[], day: string): PersonalRecord[] => {
  const perDay = new Map<string, Record<RecordKind, number>>();
  for (const e of events) {
    const k = dayKey(Date.parse(e.at));
    const c = perDay.get(k) ?? { tasksInDay: 0, noAiInDay: 0 };
    if (e.type === "task_completed") c.tasksInDay++;
    if (e.type === "decision_made" && !e.usedAi) c.noAiInDay++;
    perDay.set(k, c);
  }
  const today = perDay.get(day);
  const prior = [...perDay.entries()].filter(([k]) => k < day);
  if (!today || prior.length < RECORD_RULES.minPriorDays) return [];
  return (["noAiInDay", "tasksInDay"] as const).flatMap((kind) => {
    const previousBest = Math.max(0, ...prior.map(([, c]) => c[kind]));
    const value = today[kind];
    return value >= RECORD_RULES.minValue && value > previousBest ? [{ kind, day, value, previousBest }] : [];
  });
};

// ---------------------------------------------------------------------------
// When is a stats drop due? (D2)
// ---------------------------------------------------------------------------

export type RewardKind = "milestone" | "weekly" | "monthly";

export interface DueReward {
  /** Stable id; once celebrated it never shows again. */
  key: string;
  kind: RewardKind;
  /** The fact being celebrated, e.g. "7 days in a row". */
  headline: string;
  from: number;
  to: number;
  milestone?: { type: "stage"; stage: Stage } | { type: "streak"; days: number } | { type: "record"; record: PersonalRecord };
}

/**
 * Milestones (stage-ups, streak marks, personal records), then the last
 * finished week and month. Never per task. A wrap is only offered for a
 * period with real activity, so there is always something true to say.
 */
export const dueRewards = (
  events: readonly MiosEvent[],
  now: number,
  celebrated: Readonly<Record<string, unknown>>,
): DueReward[] => {
  const out: DueReward[] = [];
  const last7 = { from: addDays(startOfLocalDay(now), -6), to: now };

  for (const e of events) {
    if (e.type === "stage_changed" && e.reason === "auto") {
      const key = `stage:${e.at}`;
      if (!celebrated[key]) out.push({ key, kind: "milestone", headline: `You reached ${e.to} stage`, ...last7, milestone: { type: "stage", stage: e.to } });
    }
  }

  const streak = computeStreak(events, now);
  const mark = [...STREAK_MARKS].reverse().find((m) => streak.current >= m);
  if (mark && streak.runStart) {
    const key = `streak:${streak.runStart}:${mark}`;
    if (!celebrated[key]) out.push({ key, kind: "milestone", headline: `${mark} days in a row`, ...last7, milestone: { type: "streak", days: mark } });
  }

  for (const record of recordsOn(events, dayKey(now))) {
    const key = `record:${record.kind}:${record.day}`;
    if (!celebrated[key]) {
      const headline =
        record.kind === "noAiInDay"
          ? `New record: ${record.value} decisions without AI in one day`
          : `New record: ${record.value} tasks done in one day`;
      out.push({ key, kind: "milestone", headline, ...last7, milestone: { type: "record", record } });
    }
  }

  const thisWeek = weekStart(now);
  const lastWeek = addDays(thisWeek, -7);
  const weekKey = `week:${dayKey(lastWeek)}`;
  if (!celebrated[weekKey] && periodStats(events, lastWeek, thisWeek).activeDays > 0) {
    out.push({ key: weekKey, kind: "weekly", headline: "Your week", from: lastWeek, to: thisWeek });
  }

  const thisMonth = monthStart(now);
  const lastMonthDate = new Date(thisMonth);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = lastMonthDate.getTime();
  const monthKey = `month:${dayKey(lastMonth).slice(0, 7)}`;
  if (!celebrated[monthKey] && periodStats(events, lastMonth, thisMonth).activeDays > 0) {
    out.push({ key: monthKey, kind: "monthly", headline: "Your month", from: lastMonth, to: thisMonth });
  }

  return out;
};
