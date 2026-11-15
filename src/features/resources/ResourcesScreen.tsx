"use client";

import { useState } from "react";
import {
  DEFAULT_TOLERANCE,
  MEDICINE_DISCLAIMER,
  PRESETS_BY_ID,
  RESOURCE_PRESETS,
  TOLERANCE_RANGE,
  type CurveFact,
  type ItemKind,
  type ResourceItem,
} from "@/core";
import { useNow, useResources } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatTime, fromLocalInput } from "@/ui/format";
import { Button, Card, Empty } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { MedsCard } from "@/features/meds/MedsCard";
import { ChartLegend, ChartTable, DayChart } from "./DayChart";
import { ResourceStrip } from "./ResourceStrip";
import s from "./resources.module.css";

const DAY_MS = 24 * 3_600_000;
const GROUPS: { kind: Exclude<ItemKind, "sleep">; title: string }[] = [
  { kind: "drink", title: "Drinks" },
  { kind: "food", title: "Food" },
];
const BASIS_LABEL = { label: "FDA label", reference: "Drug reference", estimate: "MiOS estimate" } as const;

export function ResourcesScreen() {
  const now = useNow(60_000);
  const nowMs = Date.parse(now);
  const [offset, setOffset] = useState(0);
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const dayStart = today.getTime() + offset * DAY_MS;
  const { series } = useResources(now, dayStart);
  const [showTable, setShowTable] = useState(false);

  const dayName =
    offset === 0
      ? "Today"
      : offset === -1
        ? "Yesterday"
        : new Date(dayStart).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className={s.screen}>
      <header>
        <h1 className={s.pageTitle}>Resources</h1>
        <p className={s.lead}>What you eat, drink, sleep and take moves your Focus, Energy and Hydration. Rough estimates, not measurements.</p>
      </header>

      <ResourceStrip />

      <div className={s.columns}>
        <div className={s.stack}>
          <Card
            title="Your day"
            action={
              <div className={s.toolbar}>
                <Button size="sm" variant="icon" onClick={() => setOffset((o) => o - 1)} aria-label="Previous day">
                  ‹
                </Button>
                <span className={s.dayLabel}>{dayName}</span>
                <Button size="sm" variant="icon" onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0} aria-label="Next day">
                  ›
                </Button>
              </div>
            }
          >
            <div className={s.stack}>
              <ChartLegend />
              <DayChart series={series} dayStart={dayStart} now={nowMs} />
              <div className={s.toolbar}>
                <Button size="sm" variant="plain" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
                  {showTable ? "Hide table" : "Show as table"}
                </Button>
                <span className={s.presetSub}>Running tasks drain Focus and Energy too.</span>
              </div>
              {showTable && <ChartTable series={series} />}
            </div>
          </Card>

          <MedsCard now={nowMs} />
          <MedicineCard />
        </div>

        <aside className={s.stack}>
          <LogCard />
          <HistoryCard dayStart={dayStart} />
          <ToleranceCard />
        </aside>
      </div>
    </div>
  );
}

/** C2 + C3: one-tap presets, sleep, and logging at another time. */
function LogCard() {
  const logResource = useMios((st) => st.logResource);
  const toast = useToast((st) => st.show);
  const [at, setAt] = useState("");
  const [sleep, setSleep] = useState("7.5");

  const log = (item: ResourceItem) => {
    logResource(item.id, { at: fromLocalInput(at) });
    toast(`${item.name} logged${at ? ` at ${formatTime(fromLocalInput(at)!)}` : ""}.`);
  };

  return (
    <Card title="Log" hint="One tap logs it now, or pick a time first.">
      <div className={s.stack}>
        <label>
          When (leave empty for now)
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        {GROUPS.map((g) => (
          <div key={g.kind} className={s.group}>
            <span className={s.groupTitle}>{g.title}</span>
            <div className={s.presetGrid}>
              {RESOURCE_PRESETS.filter((p) => p.kind === g.kind).map((p) => (
                <button key={p.id} type="button" className={s.preset} onClick={() => log(p)}>
                  <span className={s.presetName}>
                    {p.icon} {p.name}
                  </span>
                  <span className={s.presetSub}>{p.serving}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className={s.group}>
          <span className={s.groupTitle}>Sleep</span>
          <div className={s.row}>
            <label>
              Hours slept
              <input type="number" min={0} max={16} step={0.5} value={sleep} onChange={(e) => setSleep(e.target.value)} />
            </label>
            <Button
              disabled={!(Number(sleep) >= 0 && Number(sleep) <= 16)}
              onClick={() => {
                logResource("sleep", { at: fromLocalInput(at), hours: Number(sleep) });
                toast(`${sleep} hours of sleep logged.`);
              }}
            >
              😴 Log sleep
            </Button>
          </div>
          <span className={s.presetSub}>Log it when you wake up. It sets the day&apos;s starting Energy and Focus.</span>
        </div>
        <div className={s.group}>
          <span className={s.groupTitle}>Medicine</span>
          <div className={s.presetGrid}>
            {RESOURCE_PRESETS.filter((p) => p.kind === "medicine").map((p) => (
              <button key={p.id} type="button" className={s.preset} onClick={() => log(p)}>
                <span className={s.presetName}>
                  {p.icon} {p.name}
                </span>
                <span className={s.presetSub}>{p.detail}</span>
              </button>
            ))}
          </div>
          <span className={s.presetSub}>Tracking only, not medical advice. Details and sources below the chart.</span>
        </div>
      </div>
    </Card>
  );
}

function HistoryCard({ dayStart }: { dayStart: number }) {
  const entries = useMios((st) => st.resourceEntries);
  const removeResource = useMios((st) => st.removeResource);
  const day = entries
    .filter((e) => Date.parse(e.at) >= dayStart && Date.parse(e.at) < dayStart + DAY_MS)
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <Card title="Logged" hint="Remove anything logged by mistake.">
      {day.length ? (
        <ul className={s.entries}>
          {day.map((e) => {
            const item = PRESETS_BY_ID.get(e.itemId);
            return (
              <li key={e.id} className={s.entry}>
                <span className={s.time}>{formatTime(e.at)}</span>
                <span>
                  {item?.icon} {item?.name ?? e.itemId}
                  {e.hours !== undefined && ` · ${e.hours} h`}
                </span>
                <Button size="sm" variant="plain" onClick={() => removeResource(e.id)} aria-label={`Remove ${item?.name}`}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>Nothing logged this day.</Empty>
      )}
    </Card>
  );
}

/** C3 medicine screen: disclaimer, and every number's source. */
function MedicineCard() {
  const meds = RESOURCE_PRESETS.filter((p) => p.kind === "medicine" || p.facts);
  return (
    <Card title="Medicine and caffeine details" hint="Where each curve comes from.">
      <p className={s.disclaimer} role="note">
        {MEDICINE_DISCLAIMER}
      </p>
      {meds.map((m) => (
        <div key={m.id} className={s.med}>
          <div className={s.medHead}>
            <strong>
              {m.icon} {m.name}
            </strong>
            {m.detail && <span className={s.presetSub}>{m.detail}</span>}
          </div>
          <div className={s.facts}>
            {(["onset", "peak", "duration", "halfLife"] as const).map((key) =>
              m.facts?.[key] ? <Fact key={key} label={{ onset: "Onset", peak: "Peak", duration: "Lasts", halfLife: "Half-life" }[key]} fact={m.facts[key]!} /> : null,
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}

function Fact({ label, fact }: { label: string; fact: CurveFact }) {
  return (
    <div className={s.fact}>
      <span className={s.factLabel}>{label}</span>
      <span>
        {fact.value}
        <span className={`${s.basis} ${s[`basis_${fact.basis}`]}`}>{BASIS_LABEL[fact.basis]}</span>
        {fact.note && <span className={s.presetSub}> {fact.note}</span>}
        {fact.source && (
          <details>
            <summary className={s.presetSub}>Source</summary>
            <blockquote className={s.quote}>
              &ldquo;{fact.source.quote}&rdquo;
              <br />
              <a href={fact.source.url} target="_blank" rel="noopener noreferrer">
                {fact.source.title}
              </a>
              {fact.source.section && `, ${fact.source.section}`}, revised {fact.source.revised}
            </blockquote>
          </details>
        )}
      </span>
    </div>
  );
}

/** C4: personal tolerance for any item. */
function ToleranceCard() {
  const tolerances = useMios((st) => st.tolerances);
  const setTolerance = useMios((st) => st.setTolerance);
  const [itemId, setItemId] = useState("coffee");
  const item = PRESETS_BY_ID.get(itemId)!;
  const tol = tolerances[itemId] ?? DEFAULT_TOLERANCE;
  const adjusted = Object.keys(tolerances);

  const slider = (key: "strength" | "duration", label: string) => (
    <label className={s.slider}>
      {label}
      <input
        type="range"
        min={TOLERANCE_RANGE.min * 100}
        max={TOLERANCE_RANGE.max * 100}
        step={5}
        value={Math.round(tol[key] * 100)}
        onChange={(e) => setTolerance(itemId, { ...tol, [key]: Number(e.target.value) / 100 })}
      />
      <span>{Math.round(tol[key] * 100)}%</span>
    </label>
  );

  return (
    <Card title="Your tolerance" hint="Make any item match how it works for you.">
      <div className={s.stack}>
        <label>
          Item
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {RESOURCE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {tolerances[p.id] ? " (adjusted)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className={s.tol}>
          <div className={s.tolHead}>
            <span>
              {item.icon} {item.name}
            </span>
            {tolerances[itemId] && (
              <Button size="sm" variant="plain" onClick={() => setTolerance(itemId, null)}>
                Reset
              </Button>
            )}
          </div>
          {slider("strength", "Strength")}
          {slider("duration", "Duration")}
        </div>
        {adjusted.length > 0 && (
          <span className={s.presetSub}>Adjusted: {adjusted.map((id) => PRESETS_BY_ID.get(id)?.name ?? id).join(", ")}</span>
        )}
      </div>
    </Card>
  );
}
