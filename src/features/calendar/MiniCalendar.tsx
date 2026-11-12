"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { dayKey, type AgendaItem, type ModeId } from "@/core";
import { useAgenda, useCalendarLooks, useNow, type CalendarLook } from "@/state/hooks";
import { Card } from "@/ui/primitives";
import { DayList, timeLabel } from "./AgendaList";
import s from "./calendar.module.css";
import { calStyle, lookOf, MIOS_LOOK } from "./colors";

type View = "day" | "week" | "month";

const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PER_DAY_IN_WEEK = 3;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday of the week containing `d`. */
const weekStart = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const fromKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/**
 * A quick look at the shared calendar from any mode: today, this week or
 * this month, like any calendar app, but for looking only. Changes happen on
 * the task itself or on the Calendar screen.
 */
export function MiniCalendar({ mode }: { mode: ModeId }) {
  const now = useNow(60_000);
  const nowMs = Date.parse(now);
  const today = useMemo(() => startOfDay(new Date(nowMs)), [nowMs]);
  const [view, setView] = useState<View>("day");
  const [cursor, setCursor] = useState<Date | null>(null);
  const at = cursor ?? today;

  // The range each view needs. Month uses a full 6-week grid starting on Monday.
  const range = useMemo(() => {
    if (view === "day") return { from: at, days: 1 };
    if (view === "week") return { from: weekStart(at), days: 7 };
    return { from: weekStart(new Date(at.getFullYear(), at.getMonth(), 1)), days: 42 };
  }, [view, at]);
  const agenda = useAgenda(range.from, range.days, now);
  const looks = useCalendarLooks();

  const step = (dir: 1 | -1) => {
    if (view === "day") setCursor(addDays(at, dir));
    else if (view === "week") setCursor(addDays(at, 7 * dir));
    else setCursor(new Date(at.getFullYear(), at.getMonth() + dir, 1));
  };
  const openDay = (k: string) => {
    setCursor(fromKey(k));
    setView("day");
  };

  const todayKey = dayKey(nowMs);
  const atKey = dayKey(at.getTime());
  const title =
    view === "day"
      ? atKey === todayKey
        ? `Today · ${at.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`
        : at.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
      : view === "week"
        ? `${range.from.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(range.from, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
        : at.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const onCurrent =
    view === "day"
      ? atKey === todayKey
      : view === "week"
        ? dayKey(weekStart(at).getTime()) === dayKey(weekStart(today).getTime())
        : at.getMonth() === today.getMonth() && at.getFullYear() === today.getFullYear();

  return (
    <Card
      title="Calendar"
      action={
        <Link href="/calendar" className={s.openLink}>
          Open calendar
        </Link>
      }
    >
      <div className={s.miniBar}>
        <div className={s.segmented} role="tablist" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={s.segment}
              onClick={() => {
                setView(v.id);
                if (v.id === "day") setCursor(null);
              }}
            >
              {v.id === "day" && view === "day" && atKey !== todayKey ? "Day" : v.label}
            </button>
          ))}
        </div>
        <div className={s.stepper}>
          <button type="button" className={s.stepBtn} aria-label="Previous" onClick={() => step(-1)}>
            ‹
          </button>
          {!onCurrent && (
            <button type="button" className={s.todayBtn} onClick={() => setCursor(null)}>
              Today
            </button>
          )}
          <button type="button" className={s.stepBtn} aria-label="Next" onClick={() => step(1)}>
            ›
          </button>
        </div>
      </div>
      <h3 className={s.miniTitle}>{title}</h3>

      {view === "day" && <DayList items={agenda.get(atKey) ?? []} now={nowMs} isToday={atKey === todayKey} mode={mode} compact />}

      {view === "week" && (
        <ul className={s.weekList}>
          {[...agenda.entries()].map(([k, items], i) => (
            <li key={k}>
              <button type="button" className={`${s.weekRow} ${k === todayKey ? s.isToday : ""}`} onClick={() => openDay(k)}>
                <span className={s.weekDay}>
                  {WEEKDAYS[i]} <strong>{fromKey(k).getDate()}</strong>
                </span>
                <span className={s.weekItems}>
                  {items.length === 0 && <span className={s.empty}>—</span>}
                  {items.slice(0, PER_DAY_IN_WEEK).map((it) => (
                    <span key={it.id} className={`${s.weekItem} ${kindClass(it)}`} style={calStyle(lookOf(it.sourceId, looks).color)}>
                      <span className={s.dot} aria-hidden />
                      <span className={s.weekTime}>{timeLabel(it)}</span> {it.title}
                    </span>
                  ))}
                  {items.length > PER_DAY_IN_WEEK && <span className={s.more}>+{items.length - PER_DAY_IN_WEEK} more</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {view === "month" && (
        <div className={s.month}>
          {WEEKDAYS.map((d) => (
            <span key={d} className={s.monthHead}>
              {d[0]}
            </span>
          ))}
          {[...agenda.entries()].map(([k, items]) => {
            const d = fromKey(k);
            const inMonth = d.getMonth() === at.getMonth();
            return (
              <button
                key={k}
                type="button"
                className={`${s.monthCell} ${inMonth ? "" : s.outside} ${k === todayKey ? s.isToday : ""}`}
                aria-label={`${d.toDateString()}: ${items.length} ${items.length === 1 ? "item" : "items"}`}
                onClick={() => openDay(k)}
              >
                <span className={s.monthNum}>{d.getDate()}</span>
                <span className={s.monthDots} aria-hidden>
                  {items.slice(0, 3).map((it) => (
                    <span key={it.id} className={`${s.dot} ${kindClass(it)}`} style={calStyle(lookOf(it.sourceId, looks).color)} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {view !== "day" && (
        <p className={s.legend} aria-hidden>
          {[MIOS_LOOK, ...[...looks.values()].filter((l) => !l.mios)].map((l: CalendarLook) => (
            <span key={l.name + l.color} style={calStyle(l.color)}>
              <span className={s.dot} /> {l.name}
            </span>
          ))}
          <span className={s.k_due} style={calStyle(MIOS_LOOK.color)}>
            <span className={s.dot} /> Due
          </span>
          <span className={s.k_repeat} style={calStyle(MIOS_LOOK.color)}>
            <span className={s.dot} /> Repeats
          </span>
        </p>
      )}
    </Card>
  );
}

/** The dot's colour is the calendar; its shape says what kind of item it is. */
const kindClass = (it: AgendaItem): string => {
  switch (it.kind) {
    case "due":
      return s.k_due;
    case "repeat":
      return s.k_repeat;
    default:
      return "";
  }
};
