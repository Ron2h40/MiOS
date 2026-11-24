"use client";

import Link from "next/link";
import { useState } from "react";
import { curveAt, PRESETS_BY_ID, RESOURCE_KEYS, startOfDay, type ResourceKey } from "@/core";
import { useNow, useResources } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes, formatTime, fromLocalInput, toLocalInput } from "@/ui/format";
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
  const { levels, active, at: nowMs } = useResources(now);
  const entries = useMios((st) => st.resourceEntries);
  const tolerances = useMios((st) => st.tolerances);
  /**
   * The active item adding the most to a resource right now. Something just
   * taken adds nothing yet (effects ramp up), so it's named as kicking in
   * rather than leaving the tile at "Nothing active".
   */
  const topFor = (k: ResourceKey) => {
    let best: { name: string; hoursLeft: number; amount: number } | null = null;
    let starting: string | null = null;
    for (const a of active) {
      if (!(a.item.effects[k] ?? 0)) continue;
      const tol = tolerances[a.item.id] ?? { strength: 1, duration: 1 };
      const amount =
        (a.item.effects[k] ?? 0) * tol.strength * curveAt(a.item.shape, (nowMs - Date.parse(a.entry.at)) / 3_600_000, tol.duration);
      if (amount > 0 && (!best || amount > best.amount)) best = { name: a.item.name, hoursLeft: a.hoursLeft, amount };
      else if (amount <= 0 && !starting) starting = a.item.name;
    }
    return best ?? (starting ? { name: starting, starting: true as const } : null);
  };
  const logResource = useMios((st) => st.logResource);
  const removeResource = useMios((st) => st.removeResource);
  const toast = useToast((st) => st.show);
  // "Earlier…": the next chip tapped is logged at this time, then it's back to now.
  const [earlier, setEarlier] = useState<string | null>(null);
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
              {!top
                ? "Nothing active"
                : "starting" in top
                  ? `${top.name} · kicking in`
                  : `Mostly ${top.name} · ${formatMinutes(top.hoursLeft * 60)} left`}
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
                      const entry = logResource(id, { at: earlier ? fromLocalInput(earlier) : undefined });
                      toast(`${item.name} logged${earlier ? ` at ${formatTime(entry.at)}` : ""}.`, "info", {
                        label: "Undo",
                        onClick: () => removeResource(entry.id),
                      });
                      setEarlier(null);
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
        {earlier === null ? (
          <button
            type="button"
            className={s.linkButton}
            onClick={() => setEarlier(toLocalInput(new Date(Date.now() - 30 * 60_000).toISOString()))}
          >
            Forgot to log? Earlier…
          </button>
        ) : (
          <span className={s.earlier}>
            <input
              type="datetime-local"
              aria-label="Log the next item at"
              value={earlier}
              max={toLocalInput(new Date().toISOString())}
              onChange={(e) => setEarlier(e.target.value)}
            />
            <span className={s.presetSub}>then tap the item</span>
            <button type="button" className={s.linkButton} onClick={() => setEarlier(null)}>
              Cancel
            </button>
          </span>
        )}
      </div>
    </section>
  );
}
