"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { dayKey, freeTimeToday, occurrences, type AgendaItem, type ProtectedBlock } from "@/core";
import { useAgenda, useNow } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes } from "@/ui/format";
import { usePhoneUi } from "./phoneUi";
import s from "./phone.module.css";

/**
 * One calendar that works like the iPhone's, in MiOS's look: a week strip to
 * pick a day, the day as an hour grid (calendar items, planned tasks,
 * protected time, free gaps and a "now" line), and the month from the month
 * name. Tap a free gap to add a task there, or a task to act on it. Adding
 * or syncing calendars stays on the computer.
 */

const HOUR_PX = 52;
const HOUR_MS = 3_600_000;
/** Free time on days ahead counts from the start of the morning. */
const MORNING_HOUR = 7;
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** Agenda kinds that take up time on the grid. Deadlines and all-day items sit above it. */
const ON_GRID = new Set<AgendaItem["kind"]>(["task", "busy", "pending", "auto"]);

type BlockKind = "busy" | "task" | "protected" | "free";

interface Block {
  start: number;
  end: number;
  kind: BlockKind;
  title: string;
  taskId?: string;
  /** Side-by-side position when items overlap. */
  col: number;
  cols: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Sunday of the week containing `d`, like the iPhone in the US. */
const weekStart = (d: Date) => addDays(startOfDay(d), -d.getDay());
const monthGridStart = (d: Date) => weekStart(new Date(d.getFullYear(), d.getMonth(), 1));

const hourLabel = (h: number) => (h === 0 || h === 24 ? "12 AM" : h === 12 ? "Noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** A free gap starting now begins at the next 5 minutes, so the new task isn't already late. */
const roundUp5 = (ms: number) => Math.ceil(ms / 300_000) * 300_000;

/** Items that overlap share the width, side by side. */
const layout = (taken: Omit<Block, "col" | "cols">[]): Block[] => {
  const sorted = [...taken].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Block[] = [];
  let group: Block[] = [];
  let groupEnd = -Infinity;
  const flush = () => {
    const cols = Math.max(1, ...group.map((b) => b.col + 1));
    for (const b of group) b.cols = cols;
    group = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd) {
      flush();
      groupEnd = -Infinity;
    }
    // The first column that's free by now.
    let col = 0;
    while (group.some((b) => b.col === col && b.end > item.start)) col++;
    const block = { ...item, col, cols: 1 };
    group.push(block);
    out.push(block);
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return out;
};

/** A day's grid: what takes time, plus free gaps from `freeFrom` (none for days gone by). */
const dayBlocks = (items: readonly AgendaItem[], blocks: readonly ProtectedBlock[], day: Date, freeFrom: number | null) => {
  const from = day.getTime();
  const to = addDays(day, 1).getTime();
  const taken = layout([
    ...items
      .filter((i) => ON_GRID.has(i.kind) && !i.allDay && i.end !== undefined)
      .map((i) => ({
        start: Math.max(i.start, from),
        end: Math.min(i.end!, to),
        kind: (i.kind === "task" ? "task" : "busy") as BlockKind,
        title: i.title,
        ...(i.taskId ? { taskId: i.taskId } : {}),
      })),
    ...blocks.flatMap((b) =>
      occurrences(b, day, new Date(to)).map((o) => ({
        start: Math.max(o.start.getTime(), from),
        end: Math.min(o.end.getTime(), to),
        kind: "protected" as BlockKind,
        title: b.label,
      })),
    ),
  ].filter((b) => b.end > b.start));
  if (freeFrom === null) return { blocks: taken, freeMinutes: 0 };
  const free = freeTimeToday(items, blocks, freeFrom);
  const gaps = free.slots.filter((x) => x.kind === "free").map((x) => ({ ...x, kind: "free" as BlockKind, col: 0, cols: 1 }));
  return { blocks: [...taken, ...gaps], freeMinutes: free.freeMinutes };
};

export function PhoneCalendar() {
  const now = useNow(60_000);
  const nowMs = Date.parse(now);
  const today = useMemo(() => startOfDay(new Date(nowMs)), [nowMs]);
  const protectedBlocks = useMios((st) => st.settings.protectedBlocks);
  const tasks = useMios((st) => st.tasks);
  const open = usePhoneUi((st) => st.open);

  const [view, setView] = useState<"day" | "month">("day");
  const [picked, setPicked] = useState<Date | null>(null);
  const [monthAt, setMonthAt] = useState<Date | null>(null);
  const day = picked ?? today;
  const month = monthAt ?? day;
  const grid = useRef<HTMLDivElement>(null);
  const swipeX = useRef<number | null>(null);

  const range = view === "month" ? { from: monthGridStart(month), days: 42 } : { from: weekStart(day), days: 7 };
  const agenda = useAgenda(range.from, range.days, now);

  const key = dayKey(day.getTime());
  const todayKey = dayKey(today.getTime());
  const isToday = key === todayKey;
  const isPast = key < todayKey;
  const items = useMemo(() => agenda.get(key) ?? [], [agenda, key]);
  const freeFrom = isPast ? null : isToday ? nowMs : day.getTime() + MORNING_HOUR * HOUR_MS;
  const { blocks, freeMinutes } = useMemo(() => dayBlocks(items, protectedBlocks, day, freeFrom), [items, protectedBlocks, day, freeFrom]);
  const above = items.filter((i) => !ON_GRID.has(i.kind) || i.allDay || i.end === undefined);
  const open_ = new Set(tasks.filter((t) => t.state !== "done").map((t) => t.id));
  const nowHour = (nowMs - today.getTime()) / HOUR_MS;

  // Open the day at "now" (today) or at the start of the morning, like the iPhone.
  useEffect(() => {
    if (!grid.current) return;
    grid.current.scrollTop = ((isToday ? Math.max(nowHour - 1, 0) : 8) * HOUR_PX) | 0;
    // Only when the day or view changes, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, view]);

  const pick = (d: Date) => {
    setPicked(dayKey(d.getTime()) === todayKey ? null : d);
    setMonthAt(null);
    setView("day");
  };

  const swipeStart = (e: PointerEvent) => {
    swipeX.current = e.clientX;
  };
  const swipeEnd = (e: PointerEvent) => {
    if (swipeX.current === null) return;
    const dx = e.clientX - swipeX.current;
    swipeX.current = null;
    if (Math.abs(dx) >= 40) pick(addDays(day, dx < 0 ? 7 : -7));
  };

  const addAt = (ms: number) => open({ kind: "add", start: new Date(roundUp5(ms)).toISOString() });
  const openTask = (id?: string) => id && open_.has(id) && open({ kind: "task", id });

  return (
    <section className={`${s.card} ${s.cal}`}>
      <div className={s.calTop}>
        <h3 className={s.calMonthName}>
          {view === "month" ? month.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Calendar"}
        </h3>
        <div className={s.calButtons}>
          {view === "day" ? (
            // Like the iPhone: the month name goes back to the month.
            <button type="button" className={s.calBack} onClick={() => setView("month")}>
              ‹ {day.toLocaleDateString(undefined, { month: "long" })}
            </button>
          ) : (
            <>
              <button type="button" className={s.calBack} aria-label="Last month" onClick={() => setMonthAt(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                ‹
              </button>
              <button type="button" className={s.calBack} aria-label="Next month" onClick={() => setMonthAt(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                ›
              </button>
            </>
          )}
          <button type="button" className={s.calToday} onClick={() => pick(today)} disabled={isToday && view === "day"}>
            Today
          </button>
        </div>
      </div>

      {view === "month" ? (
        <div className={s.calMonth}>
          {LETTERS.map((l, k) => (
            <span key={`h${k}`} className={s.calHead}>
              {l}
            </span>
          ))}
          {Array.from({ length: 42 }, (_, k) => addDays(range.from, k)).map((d) => {
            const k = dayKey(d.getTime());
            const inMonth = d.getMonth() === month.getMonth();
            const count = agenda.get(k)?.length ?? 0;
            return (
              <button
                key={k}
                type="button"
                className={`${s.calDay} ${k === todayKey ? s.calIsToday : ""} ${k === key ? s.calPicked : ""} ${inMonth ? "" : s.calOutside}`}
                aria-label={`${d.toDateString()}: ${count} ${count === 1 ? "item" : "items"}`}
                onClick={() => pick(d)}
              >
                <span>{d.getDate()}</span>
                {count > 0 && <i aria-hidden />}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className={s.week} onPointerDown={swipeStart} onPointerUp={swipeEnd} aria-label="Week. Swipe for the next or last week.">
            {LETTERS.map((l, k) => {
              const d = addDays(range.from, k);
              const dk = dayKey(d.getTime());
              return (
                <button
                  key={dk}
                  type="button"
                  className={`${s.weekDay} ${dk === todayKey ? s.calIsToday : ""} ${dk === key ? s.calPicked : ""}`}
                  aria-label={d.toDateString()}
                  onClick={() => pick(d)}
                >
                  <small>{l}</small>
                  <span>{d.getDate()}</span>
                </button>
              );
            })}
          </div>

          <div className={s.calDayHead}>
            <strong>{day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</strong>
            {freeMinutes > 0 && <span className={s.freeTotal}>{formatMinutes(freeMinutes)} free</span>}
          </div>

          {above.length > 0 && (
            <ul className={s.allDay} aria-label="All day and deadlines">
              {above.map((i) => {
                const label = i.kind === "due" ? `Due ${clock(i.start)} · ${i.title}` : i.allDay ? i.title : `${clock(i.start)} · ${i.title}`;
                const tappable = i.taskId && open_.has(i.taskId);
                return (
                  <li key={i.id}>
                    {tappable ? (
                      <button type="button" className={`${s.allDayItem} ${s[`allDay_${i.kind}`] ?? ""}`} onClick={() => openTask(i.taskId)}>
                        {label}
                      </button>
                    ) : (
                      <span className={`${s.allDayItem} ${s[`allDay_${i.kind}`] ?? ""}`}>{label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className={s.dayGrid} ref={grid}>
            <div className={s.dayInner} style={{ height: 24 * HOUR_PX }}>
              {Array.from({ length: 25 }, (_, h) => (
                <div key={h} className={s.hourLine} style={{ top: h * HOUR_PX }}>
                  {/* Like the iPhone, the hour label steps aside for the "now" time. */}
                  <span>{h === 24 || (isToday && Math.abs(h - nowHour) < 0.3) ? "" : hourLabel(h)}</span>
                </div>
              ))}

              {blocks.map((b) => {
                const top = ((b.start - day.getTime()) / HOUR_MS) * HOUR_PX;
                const hours = (b.end - b.start) / HOUR_MS;
                // Short free gaps are a dashed sliver, so they never cover the next item.
                const style = {
                  top: top + 1,
                  height: Math.max(hours * HOUR_PX - 2, b.kind === "free" ? 4 : 20),
                  ...(b.cols > 1 ? { left: `calc(50px + (100% - 52px) * ${b.col / b.cols})`, right: "auto", width: `calc((100% - 52px) / ${b.cols} - 2px)` } : {}),
                };
                const label = b.kind === "free" ? (hours >= 0.5 ? `Free · ${formatMinutes(Math.round(hours * 60))}` : "") : b.title;
                const time = `${clock(b.start)} – ${clock(b.end)}`;
                const className = `${s.block} ${s[`block_${b.kind}`]}`;
                const tappable = b.kind === "free" || (b.kind === "task" && b.taskId && open_.has(b.taskId));
                if (!tappable) {
                  return (
                    <div key={`${b.kind}-${b.start}-${b.title}`} className={className} style={style}>
                      <strong>{label}</strong>
                      {hours >= 0.75 && <span>{b.kind === "protected" ? `Protected · ${time}` : time}</span>}
                    </div>
                  );
                }
                return (
                  <button
                    key={`${b.kind}-${b.start}-${b.title}`}
                    type="button"
                    className={className}
                    style={style}
                    onClick={() => (b.kind === "free" ? addAt(b.start) : openTask(b.taskId))}
                    aria-label={b.kind === "free" ? `Free, ${time}. Add a task here` : `${label}, ${time}`}
                  >
                    {label && <strong>{label}</strong>}
                    {hours >= 0.75 && <span>{b.kind === "free" ? "Tap to add a task" : time}</span>}
                  </button>
                );
              })}

              {isToday && (
                <div className={s.nowRule} style={{ top: nowHour * HOUR_PX }}>
                  <span>{clock(nowMs).replace(/\s?[AP]M$/i, "")}</span>
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
