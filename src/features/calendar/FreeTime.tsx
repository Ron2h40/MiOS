"use client";

import { useMemo } from "react";
import { dayKey, freeTimeToday, type DaySlot } from "@/core";
import { useAgenda, useNow } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes } from "@/ui/format";
import { Card, Empty } from "@/ui/primitives";
import s from "./freeTime.module.css";

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const KIND_LABEL: Record<DaySlot["kind"], string> = {
  task: "planned task",
  busy: "calendar",
  protected: "protected time",
  free: "",
};

/** Today's free time from now to midnight, to help fit in the next task. */
export function FreeTimeCard() {
  const now = useNow(60_000);
  const nowMs = Date.parse(now);
  const today = useMemo(() => new Date(nowMs), [nowMs]);
  const agenda = useAgenda(today, 1, now);
  const blocks = useMios((st) => st.settings.protectedBlocks);
  const items = agenda.get(dayKey(nowMs));
  const { slots, freeMinutes } = useMemo(() => freeTimeToday(items ?? [], blocks, nowMs), [items, blocks, nowMs]);

  return (
    <Card
      title="Free time today"
      hint="Gaps between calendar items, planned tasks and protected time."
      action={<span className={s.total}>{freeMinutes ? `${formatMinutes(freeMinutes)} free` : "No free time left"}</span>}
    >
      {slots.length ? (
        <ol className={s.list}>
          <li className={s.now}>
            <span>{clock(nowMs)}</span> Now
          </li>
          {slots.map((x) => (
            <li key={`${x.kind}-${x.start}-${x.title}`} className={`${s.slot} ${s[x.kind]}`}>
              <span className={s.time}>{clock(Math.max(x.start, nowMs))}</span>
              <div className={s.body}>
                <strong>{x.kind === "free" ? `Free · ${formatMinutes((x.end - x.start) / 60_000)}` : x.title}</strong>
                {x.kind !== "free" && (
                  <span>
                    Until {clock(x.end)} · {KIND_LABEL[x.kind]}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>The rest of today is free.</Empty>
      )}
    </Card>
  );
}
