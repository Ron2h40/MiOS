"use client";

import { DAY_SERIES, fmtHour, NOW_HOUR, RESOURCES } from "./mockData";
import { useMockup, type SubPage } from "./store";
import s from "./mockup.module.css";

const ROWS: { page: SubPage; icon: string; label: string; hint: string }[] = [
  { page: "history", icon: "🕘", label: "History", hint: "Finished tasks · fix times" },
  { page: "progress", icon: "📈", label: "Progress and stats", hint: "Stage, guesses, stats cards" },
  { page: "meds", icon: "💊", label: "Medicines", hint: "Schedules and reminders" },
  { page: "settings", icon: "⚙️", label: "Settings", hint: "Running cap, protected time" },
];

export function MePage() {
  const m = useMockup();
  return (
    <div className={s.page}>
      <section className={s.card}>
        <div className={s.cardHead}>
          <h3>Resources today</h3>
          <span className={s.muted}>Tap 💊 to log</span>
        </div>
        <DayChart />
        <div className={s.legend}>
          {RESOURCES.map((r) => (
            <span key={r.id}>
              <i style={{ background: r.color }} aria-hidden /> {r.label} {m.data.levels[r.id]}%
            </span>
          ))}
        </div>
      </section>

      <ul className={`${s.card} ${s.menu}`}>
        {ROWS.map((r) => (
          <li key={r.page}>
            <button type="button" className={s.menuRow} onClick={() => m.openSheet({ kind: "page", page: r.page })}>
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
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const W = 320;
const H = 150;
const FROM = 7;
const TO = 23;
const x = (h: number) => ((h - FROM) / (TO - FROM)) * W;
const y = (v: number) => H - 14 - (v / 100) * (H - 28);

/** Today's levels so far, with the rest of the day left empty. */
function DayChart() {
  const m = useMockup();
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.chart} role="img" aria-label="Focus, energy and hydration through today">
      {[0, 50, 100].map((v) => (
        <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} className={s.gridLine} />
      ))}
      {[9, 12, 15, 18, 21].map((h) => (
        <text key={h} x={x(h)} y={H - 1} textAnchor="middle" className={s.axis}>
          {fmtHour(h).replace(" ", "")}
        </text>
      ))}
      {RESOURCES.map((r) => {
        const points = [...DAY_SERIES[r.id].map((v, k) => [FROM + k, v]), [NOW_HOUR, m.data.levels[r.id]]];
        return (
          <polyline
            key={r.id}
            points={points.map(([h, v]) => `${x(h)},${y(v)}`).join(" ")}
            fill="none"
            stroke={r.color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
      <line x1={x(NOW_HOUR)} x2={x(NOW_HOUR)} y1={6} y2={H - 14} className={s.nowMark} />
    </svg>
  );
}
