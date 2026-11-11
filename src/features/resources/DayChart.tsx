"use client";

import { useState, type PointerEvent } from "react";
import { RESOURCE_KEYS, type ResourceKey, type SeriesPoint } from "@/core";
import { formatTime } from "@/ui/format";
import s from "./resources.module.css";

export const RESOURCE_LABEL: Record<ResourceKey, string> = { focus: "Focus", energy: "Energy", hydration: "Hydration" };

const W = 720;
const H = 260;
const PAD = { left: 34, right: 78, top: 16, bottom: 26 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const DAY_MS = 24 * 3_600_000;

/**
 * C1: one day of Focus, Energy and Hydration on one 0–100 axis.
 * Solid up to now, dashed after (what today's logged items will still do).
 * Hover or drag for exact values; direct labels sit at each line's end.
 */
export function DayChart({ series, dayStart, now }: { series: SeriesPoint[]; dayStart: number; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const x = (t: number) => PAD.left + ((t - dayStart) / DAY_MS) * PLOT_W;
  const y = (v: number) => PAD.top + (1 - v / 100) * PLOT_H;
  const nowInDay = now >= dayStart && now <= dayStart + DAY_MS;
  const split = nowInDay ? series.findIndex((p) => p.t > now) : now < dayStart ? 0 : series.length;

  const path = (pts: SeriesPoint[], k: ResourceKey) =>
    pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");

  // Spread end labels so they never overlap, then keep them inside the plot.
  const GAP = 13;
  const last = series.at(-1)!;
  const labels = RESOURCE_KEYS.map((k) => ({ k, y: y(last[k]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + GAP);
  const overflow = labels[labels.length - 1].y - (PAD.top + PLOT_H - 4);
  if (overflow > 0) for (const l of labels) l.y -= overflow;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(series.length - 1, Math.round(frac * (series.length - 1)))));
  };
  const hp = hover !== null ? series[hover] : null;

  return (
    <div className={s.chartWrap}>
      <svg
        className={s.chartSvg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Focus, energy and hydration through the day, from 0 to 100 percent"
      >
        <g className={s.grid}>
          {[0, 25, 50, 75, 100].map((v) => (
            <line key={v} x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(v)} y2={y(v)} />
          ))}
        </g>
        <g className={s.axis}>
          {[0, 50, 100].map((v) => (
            <text key={v} x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
              {v}%
            </text>
          ))}
          {[0, 6, 12, 18, 24].map((h) => (
            <text key={h} x={x(dayStart + h * 3_600_000)} y={H - 6} textAnchor="middle">
              {h === 0 || h === 24 ? "12am" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`}
            </text>
          ))}
        </g>

        {RESOURCE_KEYS.map((k) => (
          <g key={k} className={s[k]}>
            {split > 0 && <path className={s.line} d={path(series.slice(0, split), k)} />}
            {split < series.length && (
              <path className={`${s.line} ${s.projected}`} d={path(series.slice(Math.max(0, split - 1)), k)} />
            )}
          </g>
        ))}

        {labels.map(({ k, y: ly }) => (
          <text key={k} className={s.endLabel} x={PAD.left + PLOT_W + 8} y={ly + 4}>
            {RESOURCE_LABEL[k]} {last[k]}%
          </text>
        ))}

        {nowInDay && (
          <g>
            <line className={s.nowLine} x1={x(now)} x2={x(now)} y1={PAD.top} y2={PAD.top + PLOT_H} />
            <text className={s.nowText} x={x(now)} y={PAD.top - 4} textAnchor="middle">
              Now
            </text>
          </g>
        )}

        {hp && (
          <g>
            <line className={s.crosshair} x1={x(hp.t)} x2={x(hp.t)} y1={PAD.top} y2={PAD.top + PLOT_H} />
            {RESOURCE_KEYS.map((k) => (
              <circle key={k} className={`${s.dot} ${s[k]}`} cx={x(hp.t)} cy={y(hp[k])} r={4} />
            ))}
          </g>
        )}

        {/* Hit area larger than the lines, for hover and touch */}
        <rect
          x={PAD.left}
          y={0}
          width={PLOT_W}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hp && (
        <div
          className={s.tooltip}
          style={{ left: `clamp(0px, calc(${(x(hp.t) / W) * 100}% - 64px), calc(100% - 140px))` }}
        >
          <strong>
            {formatTime(new Date(hp.t).toISOString())}
            {hp.t > now ? " · projected" : ""}
          </strong>
          {RESOURCE_KEYS.map((k) => (
            <span key={k} className={`${s.tooltipRow} ${s[k]}`}>
              <span className={s.swatch} />
              {RESOURCE_LABEL[k]}
              <b>{hp[k]}%</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChartLegend() {
  return (
    <div className={s.legend}>
      {RESOURCE_KEYS.map((k) => (
        <span key={k} className={`${s.legendItem} ${s[k]}`}>
          <span className={s.legendLine} />
          {RESOURCE_LABEL[k]}
        </span>
      ))}
      <span className={s.legendItem}>
        <span className={s.legendDash} />
        Projected from what you&apos;ve logged
      </span>
    </div>
  );
}

/** Table view of the same data, hourly (accessibility and exact values). */
export function ChartTable({ series }: { series: SeriesPoint[] }) {
  const hourly = series.filter((_, i) => i % 6 === 0);
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th>Time</th>
          {RESOURCE_KEYS.map((k) => (
            <th key={k}>{RESOURCE_LABEL[k]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {hourly.map((p) => (
          <tr key={p.t}>
            <td>{formatTime(new Date(p.t).toISOString())}</td>
            {RESOURCE_KEYS.map((k) => (
              <td key={k}>{p[k]}%</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
