"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  buildAgenda,
  busyIntervals,
  fillCalendarColors,
  pendingToday,
  averageLevels,
  buildWrap,
  computeStreak,
  dueRewards,
  periodStats,
  type DueReward,
  type Wrap,
  activeEffects,
  daySeries,
  levelsAt,
  PRESETS_BY_ID,
  runningIntervals,
  startOfDay,
  evaluateGate,
  findDeadlocks,
  findStarved,
  guessAccuracy,
  modeLoad,
  readyQueue,
  stageEnteredAt,
  STAGE_POLICY,
  tasksInMode,
  type ModeId,
} from "@/core";
import { useMios } from "./store";

/**
 * Read-side hooks. Components select raw slices from the store and derive
 * views here with useMemo, so derived arrays stay stable between renders.
 */

/** False on the server and until localStorage has loaded, to avoid hydration mismatches. */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    (cb) => useMios.persist.onFinishHydration(cb),
    () => useMios.persist.hasHydrated(),
    () => false,
  );

/** Current time, refreshed on an interval (for timers and "due soon"). */
export const useNow = (intervalMs = 30_000): string => {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

/** The single place any feature reads the assistant stage from. */
export const useStage = () => {
  const stage = useMios((s) => s.settings.stage);
  return { stage, policy: STAGE_POLICY[stage] };
};

export const useModeTasks = (mode: ModeId) => {
  const tasks = useMios((s) => s.tasks);
  return useMemo(() => {
    const inMode = tasksInMode(tasks, mode);
    return {
      all: inMode,
      running: inMode.filter((t) => t.state === "running"),
      ready: readyQueue(inMode),
      blocked: inMode.filter((t) => t.state === "blocked"),
      done: inMode
        .filter((t) => t.state === "done")
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    };
  }, [tasks, mode]);
};

export const useDeadlocks = () => {
  const tasks = useMios((s) => s.tasks);
  return useMemo(() => findDeadlocks(tasks), [tasks]);
};

export const useStarved = (now: string) => {
  const tasks = useMios((s) => s.tasks);
  const starvationDays = useMios((s) => s.settings.starvationDays);
  return useMemo(() => findStarved(tasks, { starvationDays }, now), [tasks, starvationDays, now]);
};

export const useModeLoad = (now: string) => {
  const tasks = useMios((s) => s.tasks);
  const est = useMios((s) => s.settings.defaultEstimateMinutes);
  return useMemo(() => modeLoad(tasks, now, est), [tasks, now, est]);
};

export const useGuessAccuracy = () => {
  const tasks = useMios((s) => s.tasks);
  return useMemo(() => guessAccuracy(tasks), [tasks]);
};

export const useGate = (now: string) => {
  const events = useMios((s) => s.events);
  const stage = useMios((s) => s.settings.stage);
  const startedAt = useMios((s) => s.startedAt);
  return useMemo(() => {
    const entered = stageEnteredAt(events, stage, startedAt);
    return { entered, ...evaluateGate(events, stage, entered, now) };
  }, [events, stage, startedAt, now]);
};

/** C1: resource levels now, today's curve, and what's still working. */
export const useResources = (now: string, day?: number) => {
  const entries = useMios((s) => s.resourceEntries);
  const tolerances = useMios((s) => s.tolerances);
  const events = useMios((s) => s.events);
  return useMemo(() => {
    const t = Date.parse(now);
    const input = { entries, items: PRESETS_BY_ID, tolerances, intervals: runningIntervals(events, t) };
    const dayStart = day ?? startOfDay(t);
    return {
      levels: levelsAt(input, t),
      series: daySeries(input, dayStart, 10),
      active: activeEffects(input, t),
      dayStart,
    };
  }, [entries, tolerances, events, now, day]);
};

/** D5: the current streak, derived from the event log. */
export const useStreak = (now: string) => {
  const events = useMios((s) => s.events);
  return useMemo(() => computeStreak(events, Date.parse(now)), [events, now]);
};

/** D2: stats drops waiting to be opened (milestones first, then week and month). */
export const useDueRewards = (now: string) => {
  const events = useMios((s) => s.events);
  const celebrated = useMios((s) => s.celebrated);
  return useMemo(() => dueRewards(events, Date.parse(now), celebrated), [events, celebrated, now]);
};

/** Build the cards for a reward from current data (D1, D3, D4). */
export const makeWrap = (reward: Pick<DueReward, "key" | "kind" | "headline" | "from" | "to" | "milestone">): Wrap => {
  const { events, resourceEntries, tolerances } = useMios.getState();
  const now = Date.now();
  const span = reward.to - reward.from;
  const input = { entries: resourceEntries, items: PRESETS_BY_ID, tolerances, intervals: runningIntervals(events, now) };
  const charts = averageLevels(input, reward.from, reward.to);
  return buildWrap({
    reward,
    stats: periodStats(events, reward.from, reward.to),
    previous: periodStats(events, reward.from - span, reward.from),
    streak: computeStreak(events, now),
    levels: charts?.levels ?? null,
    chartDays: charts?.days ?? 0,
    previousLevels: averageLevels(input, reward.from - span, reward.from)?.levels ?? null,
    now,
  });
};

/** E: calendar time the referee protects (unsorted or "Not MiOS" items). */
export const useBusy = () => {
  const events = useMios((s) => s.calendarEvents);
  const decisions = useMios((s) => s.calendarDecisions);
  const tasks = useMios((s) => s.tasks);
  const sources = useMios((s) => s.calendarSources);
  return useMemo(() => busyIntervals(events, decisions, tasks, sources), [events, decisions, tasks, sources]);
};

export interface CalendarLook {
  name: string;
  color: string;
  /** MiOS's own calendar, here or kept in Google. */
  mios?: boolean;
}

/** MiOS's own calendar: your tasks, deadlines and repeats, and tasks made from calendar items. */
export const MIOS_LOOK: CalendarLook = { name: "MiOS", color: "var(--accent)", mios: true };

/** E: each outside calendar's name and colour, by id. */
export const useCalendarLooks = (): Map<string, CalendarLook> => {
  const sources = useMios((s) => s.calendarSources);
  return useMemo(
    () =>
      new Map(
        fillCalendarColors(sources).map((c) => [
          c.id,
          c.mios ? { ...MIOS_LOOK, name: c.name } : { name: c.name, color: c.color ?? MIOS_LOOK.color },
        ]),
      ),
    [sources],
  );
};

/** E: today's calendar items still waiting for the morning check-in. */
export const usePendingToday = (now: string) => {
  const events = useMios((s) => s.calendarEvents);
  const decisions = useMios((s) => s.calendarDecisions);
  const tasks = useMios((s) => s.tasks);
  const day = now.slice(0, 13);
  return useMemo(
    () => pendingToday(events, decisions, tasks, Date.parse(now)),
    // Recompute when the hour changes, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, decisions, tasks, day],
  );
};

/** Calendar views: what's on each day from `from` for `days` days. Display only. */
export const useAgenda = (from: Date, days: number, now: string) => {
  const tasks = useMios((s) => s.tasks);
  const events = useMios((s) => s.calendarEvents);
  const decisions = useMios((s) => s.calendarDecisions);
  const repeats = useMios((s) => s.repeats);
  const defaultEstimateMinutes = useMios((s) => s.settings.defaultEstimateMinutes);
  const fromKey = from.toDateString();
  const minute = now.slice(0, 16);
  return useMemo(
    () => buildAgenda({ tasks, events, decisions, repeats, defaultEstimateMinutes }, from, days, Date.parse(now)),
    // `from` and `now` change identity every render; their day and minute are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, events, decisions, repeats, defaultEstimateMinutes, fromKey, days, minute],
  );
};
