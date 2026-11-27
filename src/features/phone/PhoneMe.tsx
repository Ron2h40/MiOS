"use client";

import Link from "next/link";
import type { Stage } from "@/core";
import { ChartLegend, DayChart } from "@/features/resources/DayChart";
import { useNow, useResources, useStage } from "@/state/hooks";
import { usePhoneUi } from "./phoneUi";
import s from "./phone.module.css";

export const STAGE_ICON: Record<Stage, string> = { child: "🌱", teen: "🌿", adult: "🌳" };

const ROWS = [
  { href: "/history", icon: "🕘", label: "History", hint: "Finished tasks · fix times" },
  { href: "/progress", icon: "📈", label: "Progress and stats", hint: "Stage, guesses, stats cards" },
  { href: null, icon: "💊", label: "Medicines", hint: "Daily schedules and reminders" },
  { href: "/settings", icon: "⚙️", label: "Settings", hint: "Running cap, protected time, calendars" },
] as const;

/**
 * Phone Me: your stage (under the 💊 log button), today's resources chart,
 * and the rest of MiOS one tap away.
 */
export function PhoneMe() {
  const now = useNow(60_000);
  const { stage, policy } = useStage();
  const { series, at, dayStart } = useResources(now);
  const open = usePhoneUi((st) => st.open);

  return (
    <div className={s.page}>
      <button type="button" className={s.stageBadge} onClick={() => open({ kind: "stage" })}>
        {STAGE_ICON[stage]} {policy.label} stage
      </button>

      <section className={s.card}>
        <div className={s.cardHead}>
          <h3>Resources today</h3>
          <span className={s.muted}>Tap 💊 to log</span>
        </div>
        <ChartLegend />
        <DayChart series={series} dayStart={dayStart} now={at} narrow />
        <Link href="/resources" className={s.cardLink}>
          Charts, sleep and everything logged ›
        </Link>
      </section>

      <ul className={`${s.card} ${s.menu}`}>
        {ROWS.map((r) => {
          const inner = (
            <>
              <span className={s.menuIcon} aria-hidden>
                {r.icon}
              </span>
              <span className={s.taskText}>
                <strong>{r.label}</strong>
                <span>{r.hint}</span>
              </span>
              <span className={s.chevron} aria-hidden>
                ›
              </span>
            </>
          );
          return (
            <li key={r.label}>
              {r.href ? (
                <Link href={r.href} className={s.menuRow}>
                  {inner}
                </Link>
              ) : (
                <button type="button" className={s.menuRow} onClick={() => open({ kind: "meds" })}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
