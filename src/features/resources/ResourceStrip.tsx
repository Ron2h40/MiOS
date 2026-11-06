"use client";

import Link from "next/link";
import { curveAt, PRESETS_BY_ID, RESOURCE_KEYS, startOfDay, type ResourceKey } from "@/core";
import { useNow, useResources } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes } from "@/ui/format";
import { useToast } from "@/ui/toast";
import { RESOURCE_LABEL } from "./DayChart";
import s from "./resources.module.css";

const QUICK: Record<ResourceKey, string[]> = {
  focus: ["coffee", "tea"],
  energy: ["meal", "snack"],
  hydration: ["water"],
};

/**
 * C1 + C2 at a glance on every mode: one shared set of charts (A8 glue),
 * with one-tap logging for the everyday items.
 */
export function ResourceStrip() {
  const now = useNow(60_000);
  const { levels, active } = useResources(now);
  const entries = useMios((st) => st.resourceEntries);
  const tolerances = useMios((st) => st.tolerances);
  const nowMs = Date.parse(now);
  /** The active item adding the most to a resource right now. */
  const topFor = (k: ResourceKey) => {
    let best: { name: string; hoursLeft: number; amount: number } | null = null;
    for (const a of active) {
      const tol = tolerances[a.item.id] ?? { strength: 1, duration: 1 };
      const amount =
        (a.item.effects[k] ?? 0) * tol.strength * curveAt(a.item.shape, (nowMs - Date.parse(a.entry.at)) / 3_600_000, tol.duration);
      if (amount > 0 && (!best || amount > best.amount)) best = { name: a.item.name, hoursLeft: a.hoursLeft, amount };
    }
    return best;
  };
  const logResource = useMios((st) => st.logResource);
  const toast = useToast((st) => st.show);
  const today = startOfDay(Date.parse(now));
  const countToday = (id: string) => entries.filter((e) => e.itemId === id && Date.parse(e.at) >= today).length;

  return (
    <section className={s.strip} aria-label="Resources">
      {RESOURCE_KEYS.map((k) => {
        const top = topFor(k);
        return (
          <div key={k} className={`${s.tile} ${s[k]}`}>
            <div className={s.tileHead}>
              <span className={s.tileName}>
                <span className={s.swatch} aria-hidden />
                {RESOURCE_LABEL[k]}
              </span>
              <span className={s.tileValue}>{levels[k]}%</span>
            </div>
            <div className={s.bar} aria-hidden>
              <div className={s.barFill} style={{ width: `${levels[k]}%` }} />
            </div>
            <div className={s.tileNote}>
              {top ? `Mostly ${top.name} · ${formatMinutes(top.hoursLeft * 60)} left` : "Nothing active"}
            </div>
            <div className={s.chips}>
              {QUICK[k].map((id) => {
                const item = PRESETS_BY_ID.get(id)!;
                const n = countToday(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={s.chip}
                    onClick={() => {
                      logResource(id);
                      toast(`${item.name} logged.`);
                    }}
                    aria-label={`Log ${item.name}`}
                  >
                    <span aria-hidden>{item.icon}</span>
                    {item.name}
                    {n > 0 && <span className={s.count}>×{n}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className={s.stripSide}>
        <Link href="/resources">Charts and log →</Link>
        <span className={s.presetSub}>Sleep, medicine, history</span>
      </div>
    </section>
  );
}
