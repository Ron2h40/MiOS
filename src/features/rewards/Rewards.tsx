"use client";

import { useState } from "react";
import { dayKey, type Wrap } from "@/core";
import { makeWrap, useDueRewards, useNow, useStreak } from "@/state/hooks";
import { useMios } from "@/state/store";
import { Button, Card, Empty } from "@/ui/primitives";
import { WrapViewer } from "./WrapViewer";
import s from "./rewards.module.css";

/**
 * D2: offers a stats drop when one is due. Never pops up on its own and
 * never after a single task: the user opens it when they like.
 */
export function RewardBanner() {
  const now = useNow(60_000);
  const due = useDueRewards(now);
  const saveWrap = useMios((st) => st.saveWrap);
  const [later, setLater] = useState<string[]>([]);
  const [open, setOpen] = useState<Wrap | null>(null);
  const next = due.find((d) => !later.includes(d.key));

  return (
    <>
      {next && !open && (
        <section className={s.banner} aria-label="Stats drop ready">
          <span aria-hidden>{next.kind === "milestone" ? "🏅" : "✦"}</span>
          <div className={s.bannerText}>
            <div className={s.bannerTitle}>
              {next.kind === "milestone" ? next.headline : next.kind === "weekly" ? "Your weekly wrap is ready" : "Your monthly wrap is ready"}
            </div>
            <div className={s.bannerSub}>A few cards with your real numbers. Takes a minute.</div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setOpen(makeWrap(next))}>
            See your stats
          </Button>
          <Button variant="plain" size="sm" onClick={() => setLater((l) => [...l, next.key])}>
            Later
          </Button>
        </section>
      )}
      {open && (
        <WrapViewer
          wrap={open}
          onClose={() => {
            saveWrap(open);
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

/** D5: streak in the header. */
export function StreakBadge() {
  const now = useNow(60_000);
  const streak = useStreak(now);
  const label = streak.current
    ? `${streak.current}-day streak${streak.activeToday ? "" : ", do one task or decision today to keep it"}${streak.freezes ? `, ${streak.freezes} freeze${streak.freezes > 1 ? "s" : ""} saved` : ""}`
    : "No streak yet. Finish a task or make a decision to start one.";
  return (
    <span className={`${s.flame} ${streak.activeToday ? "" : s.flameIdle}`} title={label} aria-label={label}>
      <span aria-hidden>🔥</span>
      {streak.current}
    </span>
  );
}

/** D5 + D6 on Progress: the last two weeks, longest streak, freezes. */
export function StreakCard() {
  const now = useNow(60_000);
  const streak = useStreak(now);
  const events = useMios((st) => st.events);
  const active = new Set(
    events.filter((e) => e.type === "task_completed" || e.type === "decision_made").map((e) => dayKey(Date.parse(e.at))),
  );
  const frozen = new Set(streak.frozenDays);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.parse(now));
    d.setDate(d.getDate() - (13 - i));
    return d;
  });

  return (
    <Card
      title={`🔥 ${streak.current}-day streak`}
      hint={`Longest: ${streak.longest} ${streak.longest === 1 ? "day" : "days"} · Freezes saved: ${streak.freezes} of 2. You earn one every 7 days in a row; a missed day uses one automatically.`}
    >
      <div className={s.days} role="list" aria-label="Last 14 days">
        {days.map((d) => {
          const k = dayKey(d.getTime());
          const state = active.has(k) ? "active" : frozen.has(k) ? "frozen" : "none";
          return (
            <span
              key={k}
              role="listitem"
              className={`${s.day} ${state === "active" ? s.dayActive : state === "frozen" ? s.dayFrozen : ""}`}
              title={`${d.toLocaleDateString()}: ${state === "active" ? "active" : state === "frozen" ? "saved by a freeze" : "no activity"}`}
            >
              {d.getDate()}
            </span>
          );
        })}
      </div>
    </Card>
  );
}

/** D1: reopen past stats drops, or preview this week so far. */
export function PastWraps() {
  const wraps = useMios((st) => st.wraps);
  const [open, setOpen] = useState<Wrap | null>(null);

  const previewWeek = () => {
    const now = Date.now();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    setOpen(makeWrap({ key: "preview", kind: "weekly", headline: "This week so far", from: start.getTime(), to: now }));
  };

  return (
    <Card
      title="Stats drops"
      hint="Shown at milestones and at the end of each week and month."
      action={
        <Button size="sm" variant="plain" onClick={previewWeek}>
          This week so far
        </Button>
      }
    >
      {wraps.length ? (
        <ul className={s.wrapList}>
          {wraps.map((w) => (
            <li key={w.key} className={s.wrapRow}>
              <span>
                <strong>{w.title}</strong> · {w.periodLabel}
              </span>
              <Button size="sm" onClick={() => setOpen(w)}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Your first stats drop shows up at a milestone or when a week ends.</Empty>
      )}
      {open && <WrapViewer wrap={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}
