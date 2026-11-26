"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { CALENDAR_TODAY, fmtHour, fmtLength, MONTH, NOW_HOUR, type MockTask } from "./mockData";
import { useMockup } from "./store";
import s from "./mockup.module.css";

/**
 * One calendar in the style of the iPhone's: a week strip to pick a day, the
 * day as an hour grid (calendar items, planned tasks, free gaps, a red "now"
 * line), and a month view from the month name. View only.
 */

const HOUR_PX = 52;
const FIRST_HOUR = 7;
const LAST_HOUR = 23;
const MIN_FREE = 0.25;
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Block {
  from: number;
  to: number;
  title: string;
  kind: "busy" | "task" | "free";
  taskId?: string;
}

const weekdayOf = (d: number) => (MONTH.firstWeekday + d - 1) % 7;
const inMonth = (d: number) => d >= 1 && d <= MONTH.days;

/** Made-up calendar items for days other than today. */
const otherDay = (d: number): Block[] => {
  if (!MONTH.busy.includes(d)) return [];
  const items =
    d % 3 === 0
      ? [
          { from: 9, to: 10.5, title: "Class" },
          { from: 14, to: 15, title: "Study group" },
        ]
      : d % 3 === 1
        ? [
            { from: 11, to: 11.5, title: "Team stand-up" },
            { from: 18.5, to: 19.5, title: "Gym" },
          ]
        : [{ from: 12.5, to: 13.5, title: "Lunch with Sam" }];
  return items.map((x) => ({ ...x, kind: "busy" as const }));
};

/** Gaps of at least 15 minutes between `from` and the end of the day. */
const freeGaps = (taken: Block[], from: number): Block[] => {
  const out: Block[] = [];
  let cursor = from;
  for (const b of [...taken].sort((a, c) => a.from - c.from)) {
    if (b.from - cursor >= MIN_FREE) out.push({ from: cursor, to: b.from, title: "Free", kind: "free" });
    cursor = Math.max(cursor, b.to);
  }
  if (LAST_HOUR - cursor >= MIN_FREE) out.push({ from: cursor, to: LAST_HOUR, title: "Free", kind: "free" });
  return out;
};

const blocksFor = (day: number, tasks: MockTask[]): Block[] => {
  if (day !== MONTH.today) {
    const taken = otherDay(day);
    return day < MONTH.today ? taken : [...taken, ...freeGaps(taken, FIRST_HOUR)];
  }
  const taken: Block[] = [
    ...CALENDAR_TODAY.map((c) => ({ ...c, kind: "busy" as const })),
    ...tasks
      .filter((t) => t.start !== undefined && t.state !== "done")
      .map((t) => ({ from: t.start!, to: t.start! + (t.guess ?? 30) / 60, title: t.title, kind: "task" as const, taskId: t.id })),
  ];
  // Free time only counts from now on.
  return [...taken, ...freeGaps(taken.filter((b) => b.to > NOW_HOUR), NOW_HOUR)];
};

export function PhoneCalendar({ tasks }: { tasks: MockTask[] }) {
  const m = useMockup();
  const [view, setView] = useState<"day" | "month">("day");
  const [day, setDay] = useState(MONTH.today);
  const grid = useRef<HTMLDivElement>(null);
  const swipeX = useRef<number | null>(null);

  const blocks = blocksFor(day, tasks);
  const free = blocks.filter((b) => b.kind === "free").reduce((sum, b) => sum + (b.to - b.from), 0);
  const weekStart = day - weekdayOf(day);
  const isToday = day === MONTH.today;

  // Open the day at "now" (today) or at the start of the morning, like the iPhone does.
  useEffect(() => {
    if (!grid.current) return;
    const hour = isToday ? NOW_HOUR - 1 : 8;
    grid.current.scrollTop = (hour - FIRST_HOUR) * HOUR_PX;
  }, [day, isToday, view]);

  const pick = (d: number) => {
    if (!inMonth(d)) return;
    setDay(d);
    setView("day");
  };

  const swipeStart = (e: PointerEvent) => {
    swipeX.current = e.clientX;
  };
  const swipeEnd = (e: PointerEvent) => {
    if (swipeX.current === null) return;
    const dx = e.clientX - swipeX.current;
    swipeX.current = null;
    if (Math.abs(dx) < 40) return;
    const next = day + (dx < 0 ? 7 : -7);
    pick(Math.min(Math.max(next, 1), MONTH.days));
  };

  return (
    <section className={`${s.card} ${s.cal}`}>
      <div className={s.calTop}>
        {view === "day" ? (
          <button type="button" className={s.calBack} onClick={() => setView("month")}>
            ‹ November
          </button>
        ) : (
          <strong className={s.calMonthName}>{MONTH.name}</strong>
        )}
        <button type="button" className={s.calToday} onClick={() => pick(MONTH.today)} disabled={isToday && view === "day"}>
          Today
        </button>
      </div>

      {view === "month" ? (
        <div className={s.calMonth}>
          {LETTERS.map((l, k) => (
            <span key={`h${k}`} className={s.calHead}>
              {l}
            </span>
          ))}
          {Array.from({ length: MONTH.firstWeekday }, (_, k) => (
            <span key={`pad${k}`} />
          ))}
          {Array.from({ length: MONTH.days }, (_, k) => k + 1).map((d) => (
            <button
              key={d}
              type="button"
              className={`${s.calDay} ${d === MONTH.today ? s.calIsToday : ""} ${d === day ? s.calPicked : ""}`}
              onClick={() => pick(d)}
            >
              <span>{d}</span>
              {MONTH.busy.includes(d) && <i aria-hidden />}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className={s.week} onPointerDown={swipeStart} onPointerUp={swipeEnd} aria-label="Week. Swipe for the next or last week.">
            {LETTERS.map((l, k) => {
              const d = weekStart + k;
              return (
                <button
                  key={k}
                  type="button"
                  className={`${s.weekDay} ${d === MONTH.today ? s.calIsToday : ""} ${d === day ? s.calPicked : ""}`}
                  disabled={!inMonth(d)}
                  onClick={() => pick(d)}
                >
                  <small>{l}</small>
                  <span>{inMonth(d) ? d : ""}</span>
                </button>
              );
            })}
          </div>

          <div className={s.calDayHead}>
            <strong>
              {DAY_NAMES[weekdayOf(day)]}, November {day}
            </strong>
            {free > 0 && <span className={s.freeTotal}>{fmtLength(free * 60)} free</span>}
          </div>

          <div className={s.dayGrid} ref={grid}>
            <div className={s.dayInner} style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_PX }}>
              {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, k) => FIRST_HOUR + k).map((h) => (
                <div key={h} className={s.hourLine} style={{ top: (h - FIRST_HOUR) * HOUR_PX }}>
                  {/* Like the iPhone, the hour label steps aside for the "now" time. */}
                  <span>{h === LAST_HOUR || (isToday && Math.abs(h - NOW_HOUR) < 0.3) ? "" : fmtHour(h)}</span>
                </div>
              ))}

              {blocks.map((b, k) => {
                const hours = b.to - b.from;
                // Short free gaps are just a dashed sliver, so they never cover the next item.
                const style = { top: (b.from - FIRST_HOUR) * HOUR_PX + 1, height: Math.max(hours * HOUR_PX - 2, b.kind === "free" ? 4 : 20) };
                const label = b.kind === "free" ? (hours >= 0.5 ? `Free · ${fmtLength(hours * 60)}` : "") : b.title;
                const time = `${fmtHour(b.from)} – ${fmtHour(b.to)}`;
                const className = `${s.block} ${s[`block_${b.kind}`]}`;
                if (b.kind === "busy") {
                  return (
                    <div key={k} className={className} style={style}>
                      <strong>{label}</strong>
                      {hours >= 0.75 && <span>{time}</span>}
                    </div>
                  );
                }
                return (
                  <button
                    key={k}
                    type="button"
                    className={className}
                    style={style}
                    onClick={() =>
                      b.taskId
                        ? m.openSheet({ kind: "task", id: b.taskId })
                        : m.openSheet({ kind: "add", start: `2026-11-${String(day).padStart(2, "0")}T${toClock(b.from)}` })
                    }
                    aria-label={b.kind === "free" ? `${label}, ${time}. Add a task here` : `${label}, ${time}`}
                  >
                    {label && <strong>{label}</strong>}
                    {hours >= 0.75 && <span>{b.kind === "free" ? "Tap to add a task" : time}</span>}
                  </button>
                );
              })}

              {isToday && (
                <div className={s.nowRule} style={{ top: (NOW_HOUR - FIRST_HOUR) * HOUR_PX }}>
                  <span>{fmtHour(NOW_HOUR).replace(" AM", "").replace(" PM", "")}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      <p className={s.footNote}>Adding or syncing calendars is on the computer.</p>
    </section>
  );
}

const toClock = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
