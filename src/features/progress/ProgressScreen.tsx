"use client";

import { useMemo } from "react";
import { STAGE_POLICY, STAGES, type GateSignal } from "@/core";
import { useGate, useGuessAccuracy, useNow, useStage } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes, pct } from "@/ui/format";
import { Card } from "@/ui/primitives";
import s from "./progress.module.css";

export function ProgressScreen() {
  const now = useNow();
  const { stage, policy } = useStage();
  const setStage = useMios((st) => st.setStage);
  const events = useMios((st) => st.events);
  const gate = useGate(now);
  const guesses = useGuessAccuracy();

  // All-time stats are never reset, even when the user moves back a stage.
  const allTime = useMemo(() => {
    const decisions = events.filter((e) => e.type === "decision_made");
    const completed = events.filter((e) => e.type === "task_completed");
    return {
      withDeadline: completed.filter((e) => e.onTime !== null).length,
      onTime: completed.filter((e) => e.onTime === true).length,
      noDeadline: completed.filter((e) => e.onTime === null).length,
      noAi: decisions.filter((e) => !e.usedAi).length,
      deadlocks: events.filter((e) => e.type === "deadlock_broken").length,
      stageUps: events.filter((e) => e.type === "stage_changed" && e.reason === "auto").length,
    };
  }, [events]);

  return (
    <div className={s.screen}>
      <header>
        <h1 className={s.pageTitle}>Progress</h1>
        <p className={s.lead}>AI help shrinks as your skill grows. Adult stage is the finish line.</p>
      </header>

      <Card title="Assistant stage" hint={policy.description}>
        <div className={s.stages} role="group" aria-label="Choose stage">
          {STAGES.map((st) => (
            <button
              key={st}
              type="button"
              className={s.stageOption}
              aria-pressed={st === stage}
              onClick={() => {
                if (st === stage) return;
                const back = STAGES.indexOf(st) < STAGES.indexOf(stage);
                if (!back || confirm(`Move back to ${STAGE_POLICY[st].label}? Progress toward the next stage starts again from zero. All-time stats are kept.`)) {
                  setStage(st, "manual");
                }
              }}
            >
              <span className={s.stageName}>{STAGE_POLICY[st].label}</span>
              <span className={s.stageDesc}>{STAGE_POLICY[st].description}</span>
            </button>
          ))}
        </div>
        <p className={s.note}>
          AI features arrive in the next build. Until then every stage runs the same hard-coded OS core.
        </p>
      </Card>

      {gate.to ? (
        <Card
          title={`Road to ${STAGE_POLICY[gate.to].label}`}
          hint="You move up automatically when every signal passes."
        >
          <ul className={s.signals}>
            {gate.signals.map((sig) => (
              <Signal key={sig.id} signal={sig} />
            ))}
          </ul>
          <p className={s.note}>
            Counting since {new Date(gate.entered).toLocaleDateString()}. Thresholds are first estimates and will be
            tuned with beta data.
          </p>
        </Card>
      ) : (
        <Card title="You've graduated">
          <p>You reached adult stage. Needing MiOS less is the goal, not a failure.</p>
        </Card>
      )}

      <Card title="Time-guess training" hint="How close your guesses land to the real time.">
        {guesses.samples.length ? (
          <div className={s.grid}>
            <Tile value={`${Math.round(guesses.meanErrorPct!)}%`} label="Average miss, all time" />
            <Tile value={`${Math.round(guesses.recentErrorPct!)}%`} label="Average miss, last 5" />
            <Tile
              value={`${guesses.medianRatio!.toFixed(2)}×`}
              label={guesses.medianRatio! > 1 ? "Tasks run longer than you guess" : "Tasks run shorter than you guess"}
            />
            <Tile value={String(guesses.samples.length)} label="Timed tasks" />
          </div>
        ) : (
          <p className={s.lead}>Guess a time before you start a task, then finish it. Results show up here.</p>
        )}
        {guesses.samples.length > 0 && (
          <p className={s.note}>
            Latest: {guesses.samples.at(-1)!.title} — guessed {formatMinutes(guesses.samples.at(-1)!.estimate)}, took{" "}
            {formatMinutes(guesses.samples.at(-1)!.actual)}.
          </p>
        )}
      </Card>

      <Card title="All time" hint="Never reset, whatever stage you're on.">
        <div className={s.grid}>
          <Tile value={`${allTime.onTime} / ${allTime.withDeadline}`} label="Deadline tasks done on time" />
          <Tile value={String(allTime.noDeadline)} label="No-deadline tasks done" />
          <Tile value={String(allTime.noAi)} label="Decisions without AI" />
          <Tile value={String(allTime.deadlocks)} label="Deadlocks broken" />
          <Tile value={String(allTime.stageUps)} label="Auto stage-ups" />
        </div>
      </Card>
    </div>
  );
}

function Signal({ signal }: { signal: GateSignal }) {
  const progress =
    signal.current === null ? 0 : Math.min(1, signal.unit === "rate" ? signal.current / signal.target : signal.current / signal.target);
  const value =
    signal.unit === "rate"
      ? `${pct(signal.current)} of ${pct(signal.target)}${signal.sample ? ` · ${signal.sample.hits}/${signal.sample.total}` : ""}`
      : `${signal.current ?? 0} of ${signal.target}${signal.unit === "days" ? " days" : ""}`;
  return (
    <li className={s.signal}>
      <span>{signal.label}</span>
      <span className={signal.pass ? s.pass : s.signalValue}>{signal.pass ? `✓ ${value}` : value}</span>
      <div className={s.bar} aria-hidden>
        <div className={`${s.fill} ${signal.pass ? s.fillPass : ""}`} style={{ width: `${progress * 100}%` }} />
      </div>
    </li>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className={s.tile}>
      <div className={s.tileValue}>{value}</div>
      <div className={s.tileLabel}>{label}</div>
    </div>
  );
}
