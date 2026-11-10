import type { ResourceKey } from "./resources";
import type { DueReward, PeriodStats, StreakState } from "./rewards";

/**
 * D1 + D3 + D4 — build a stats drop: one stat per card, with a compliment
 * first and last. Compliments are fixed templates filled with real numbers
 * (facts over flattery), so they work at every stage, including adult where
 * there is no AI. Thinking without AI is weighted highest.
 */

export interface WrapCard {
  id: string;
  tone: "compliment" | "stat";
  eyebrow: string;
  headline: string;
  /** The big number, when the card has one. */
  value?: string;
  detail?: string;
}

export interface Wrap {
  key: string;
  kind: DueReward["kind"];
  title: string;
  periodLabel: string;
  createdAt: string;
  cards: WrapCard[];
}

export interface WrapInput {
  reward: Pick<DueReward, "key" | "kind" | "headline" | "from" | "to" | "milestone">;
  stats: PeriodStats;
  /** The same-length period just before, for "more than last week". */
  previous: PeriodStats;
  streak: StreakState;
  levels: Record<ResourceKey, number> | null;
  previousLevels: Record<ResourceKey, number> | null;
  /** Days in the period with Focus/Energy/Hydration logging. */
  chartDays?: number;
  now: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

const periodWord = (kind: DueReward["kind"]) => (kind === "monthly" ? "month" : "week");

export const periodLabel = (kind: DueReward["kind"], from: number, to: number): string => {
  if (kind === "monthly") return new Date(from).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (kind === "milestone") return "Last 7 days";
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(from)} – ${fmt(to - 1)}`;
};

interface Fact {
  weight: number;
  text: string;
}

/** Every true, positive thing the data supports, best first. */
export const complimentFacts = (input: WrapInput): Fact[] => {
  const { stats: s, previous: p, streak, reward } = input;
  const word = reward.kind === "milestone" ? "7 days" : periodWord(reward.kind);
  const facts: Fact[] = [];

  if (s.decisionsNoAi > 0) {
    let text = `You made ${plural(s.decisionsNoAi, "decision")} without AI`;
    if (p.decisionsNoAi > 0 && s.decisionsNoAi > p.decisionsNoAi) text += `, ${s.decisionsNoAi - p.decisionsNoAi} more than the ${word} before.`;
    else if (s.decisions > 1 && s.decisionsNoAi === s.decisions) text += `. Every one of them was yours.`;
    else text += ".";
    facts.push({ weight: 100 + s.decisionsNoAi, text });
  }
  if (streak.current >= 2) facts.push({ weight: 60 + streak.current, text: `You showed up ${streak.current} days in a row.` });
  // Only praise deadlines when most were beaten (same 75% bar as the teen gate).
  if (s.onTime.total > 0 && s.onTime.hits / s.onTime.total >= 0.75)
    facts.push({ weight: 50 + s.onTime.hits, text: `You beat ${s.onTime.hits} of ${plural(s.onTime.total, "deadline")}.` });
  if (s.tasksDone > 0) {
    let text = `You finished ${plural(s.tasksDone, "task")}`;
    if (p.tasksDone > 0 && s.tasksDone > p.tasksDone) text += `, up from ${p.tasksDone}.`;
    else text += ".";
    facts.push({ weight: 40 + s.tasksDone, text });
  }
  if (s.deadlocksBroken > 0)
    facts.push({ weight: 35, text: `You broke ${plural(s.deadlocksBroken, "deadlock")} by choosing what comes first.` });
  if (input.chartDays) facts.push({ weight: 15 + input.chartDays, text: `You tracked your Focus, Energy and Hydration on ${plural(input.chartDays, "day")}.` });
  // Always true for a wrap (it needs activity), so the closing card always has a fact.
  if (s.activeDays >= 1) facts.push({ weight: 12 + s.activeDays, text: `You showed up on ${plural(s.activeDays, "day")} this ${word === "7 days" ? "stretch" : word}.` });
  if (streak.longest >= 2) facts.push({ weight: 10, text: `Your longest streak so far is ${plural(streak.longest, "day")}.` });

  return facts.sort((a, b) => b.weight - a.weight);
};

const trend = (now: number, before: number | undefined) =>
  before === undefined ? "" : now > before ? ` (up from ${before}%)` : now < before ? ` (down from ${before}%)` : " (same as before)";

export const buildWrap = (input: WrapInput): Wrap => {
  const { reward, stats: s, previous: p, streak, levels, previousLevels } = input;
  const facts = complimentFacts(input);
  const cards: WrapCard[] = [];
  const word = reward.kind === "milestone" ? "the 7 days before" : `last ${periodWord(reward.kind)}`;

  // Opening compliment: the milestone itself, or the strongest fact.
  if (reward.kind === "milestone") {
    cards.push({ id: "open", tone: "compliment", eyebrow: "Milestone", headline: `${reward.headline}.`, detail: facts[0]?.text });
  } else if (facts[0]) {
    cards.push({ id: "open", tone: "compliment", eyebrow: reward.headline, headline: facts[0].text });
  }

  // Thinking without AI first, and biggest.
  if (s.decisions > 0) {
    const vs = p.decisionsNoAi ? ` ${p.decisionsNoAi} ${word}.` : "";
    cards.push({
      id: "noai",
      tone: "stat",
      eyebrow: "Decisions without AI",
      headline: "Your own thinking",
      value: String(s.decisionsNoAi),
      detail: `${pct(s.decisionsNoAi, s.decisions)}% of ${plural(s.decisions, "decision")}.${vs}`,
    });
  }
  if (s.tasksDone > 0) {
    const parts = [
      s.onTime.total ? `${s.onTime.hits} of ${s.onTime.total} deadlines beaten` : "",
      s.noDeadlineDone ? `${s.noDeadlineDone} with no deadline` : "",
      p.tasksDone ? `${p.tasksDone} ${word}` : "",
    ].filter(Boolean);
    cards.push({ id: "tasks", tone: "stat", eyebrow: "Tasks done", headline: "What you finished", value: String(s.tasksDone), detail: parts.join(" · ") || undefined });
  }
  cards.push({
    id: "streak",
    tone: "stat",
    eyebrow: "Streak",
    headline: streak.current ? "Days in a row" : "Start a new streak today",
    value: String(streak.current),
    detail: [`Longest: ${plural(streak.longest, "day")}`, streak.freezes ? `${plural(streak.freezes, "freeze")} saved` : ""].filter(Boolean).join(" · "),
  });
  if (levels) {
    cards.push({
      id: "charts",
      tone: "stat",
      eyebrow: "Your charts",
      headline: "Average focus, 8am to 10pm",
      value: `${levels.focus}%`,
      detail: `Focus ${levels.focus}%${trend(levels.focus, previousLevels?.focus)} · Energy ${levels.energy}%${trend(levels.energy, previousLevels?.energy)} · Hydration ${levels.hydration}%${trend(levels.hydration, previousLevels?.hydration)}`,
    });
  }
  if (s.deadlocksBroken > 0) {
    cards.push({ id: "deadlocks", tone: "stat", eyebrow: "Deadlocks broken", headline: "Loops you untangled", value: String(s.deadlocksBroken) });
  }

  // Closing compliment: the next true fact, never a repeat of the opener's.
  const closing = facts.slice(1).find((f) => f.text !== facts[0]?.text);
  if (closing) cards.push({ id: "close", tone: "compliment", eyebrow: "One more thing", headline: closing.text });

  return {
    key: reward.key,
    kind: reward.kind,
    title: reward.headline,
    periodLabel: periodLabel(reward.kind, reward.from, reward.to),
    createdAt: new Date(input.now).toISOString(),
    cards,
  };
};
