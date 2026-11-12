"use client";

import { getMode, isNow, type AgendaItem, type ModeId } from "@/core";
import { useCalendarLooks } from "@/state/hooks";
import { formatTime } from "@/ui/format";
import { Pill } from "@/ui/primitives";
import s from "./calendar.module.css";
import { calStyle, lookOf } from "./colors";

const tagFor = (item: AgendaItem): { label: string; tone: "neutral" | "tag" | "warn" } => {
  switch (item.kind) {
    case "task":
      return { label: item.mode ? getMode(item.mode).label : "Task", tone: "tag" };
    case "due":
      return { label: "Due", tone: "warn" };
    case "pending":
      return { label: "Not sorted", tone: "warn" };
    case "auto":
      return { label: "Added each time", tone: "tag" };
    case "repeat":
      return { label: "Repeats", tone: "neutral" };
    case "free":
      return { label: "Free", tone: "neutral" };
    case "busy":
      return { label: "Busy", tone: "neutral" };
  }
};

export const timeLabel = (item: AgendaItem): string => {
  if (item.allDay) return "All day";
  const start = formatTime(new Date(item.start).toISOString());
  // Calendar items show their span; tasks and repeats show when they start (their length is a guess).
  return item.end !== undefined && item.end > item.start && item.kind !== "task" && item.kind !== "repeat"
    ? `${start}–${formatTime(new Date(item.end).toISOString())}`
    : start;
};

/**
 * One day's items. On today, a "now" line sits between what's passed and
 * what's next, and anything happening right now is highlighted. On a mode
 * screen, other modes' tasks are faded (the calendar is shared, A8).
 */
export function DayList({
  items,
  now,
  isToday,
  mode,
  compact,
}: {
  items: AgendaItem[];
  now: number;
  isToday: boolean;
  mode?: ModeId;
  compact?: boolean;
}) {
  const looks = useCalendarLooks();
  if (!items.length) return <p className={s.empty}>Nothing planned.</p>;
  const nowIndex = isToday ? items.findIndex((it) => !it.allDay && it.start > now) : -1;
  return (
    <ul className={`${s.items} ${compact ? s.compact : ""}`}>
      {items.map((it, i) => {
        const tag = tagFor(it);
        const faded = it.kind === "repeat" || (mode && mode !== "general" && it.mode && it.mode !== mode);
        const look = lookOf(it.sourceId, looks);
        return (
          <li key={it.id} className={s.itemWrap}>
            {i === nowIndex && <div className={s.nowLine} aria-label="Now" />}
            <div
              className={`${s.item} ${faded ? s.faded : ""} ${isToday && isNow(it, now) ? s.happening : ""}`}
              style={calStyle(look.color)}
            >
              <span className={s.calBar} title={`${look.name} calendar`} aria-hidden />
              <span className={s.time}>{timeLabel(it)}</span>
              <span className={s.title}>
                {it.title}
                <span className="visually-hidden"> ({look.name} calendar)</span>
              </span>
              <Pill tone={tag.tone}>{tag.label}</Pill>
            </div>
          </li>
        );
      })}
      {isToday && nowIndex === -1 && items.some((it) => !it.allDay) && (
        <li className={s.itemWrap}>
          <div className={s.nowLine} aria-label="Now" />
        </li>
      )}
    </ul>
  );
}
