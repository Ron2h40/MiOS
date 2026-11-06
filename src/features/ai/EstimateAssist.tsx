"use client";

import { useEffect, useRef, useState } from "react";
import { guessAccuracy, type Task } from "@/core";
import type { EstimateResult } from "@/ai/types";
import { useStage } from "@/state/hooks";
import { callAi, toAiTask } from "@/state/ai";
import { useMios } from "@/state/store";
import { formatMinutes } from "@/ui/format";
import { AiCard, AiHelpButton, type AiStatus } from "./AiHelp";
import s from "./ai.module.css";

const EFFORT_LABEL = { low: "Light load", medium: "Medium load", high: "Heavy load" } as const;

/**
 * B4 — task load estimate when starting a task. The user always guesses
 * first (A9 time-guess training); the AI estimate is a second opinion.
 * Child stage: shown automatically once there is a guess. Teen: on request.
 */
export function EstimateAssist({ task, guess }: { task: Task; guess: number | undefined }) {
  const tasks = useMios((st) => st.tasks);
  const logAiUse = useMios((st) => st.logAiUse);
  const { stage, policy } = useStage();
  const [status, setStatus] = useState<AiStatus<EstimateResult>>({ state: "idle" });
  const autoRan = useRef(false);

  const run = async () => {
    setStatus({ state: "loading" });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const history = guessAccuracy(tasks)
      .samples.slice(-8)
      .map((x) => ({ title: x.title, estimate: x.estimate, actual: Math.round(x.actual) }));
    const r = await callAi("estimate", { task: { ...toAiTask(task, byId), estimateMinutes: guess }, history });
    setStatus(r.ok ? { state: "done", result: r.result } : { state: "error", error: r.error });
  };

  // Child stage helps actively: estimate as soon as the user's own guess exists.
  useEffect(() => {
    if (stage !== "child" || !guess || autoRan.current) return;
    autoRan.current = true;
    logAiUse("B4");
    void run();
    // run only depends on values captured at this moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, guess]);

  if (!policy.aiButton) return null;

  return (
    <>
      {stage === "teen" && status.state === "idle" && (
        <AiHelpButton feature="estimate" label="Compare with AI" onHelp={run} disabled={!guess} />
      )}
      {stage === "child" && !guess && <p className={s.loading}>Make your guess, then AI gives a second opinion.</p>}
      <AiCard title="AI estimate" status={status} why={status.state === "done" ? status.result.why : undefined}>
        {status.state === "done" && (
          <div className={s.estimate}>
            <span className={s.estimateValue}>{formatMinutes(status.result.minutes)}</span>
            <span>{EFFORT_LABEL[status.result.effort]}</span>
            {guess && (
              <span className={s.sub}>
                Your guess: {formatMinutes(guess)}. MiOS times the real thing either way.
              </span>
            )}
          </div>
        )}
      </AiCard>
    </>
  );
}
