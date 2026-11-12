"use client";

import { useState } from "react";
import { cleanSteps, type Task } from "@/core";
import type { BreakdownResult, CheckStepsResult } from "@/ai/types";
import { AiCard, type AiStatus } from "@/features/ai/AiHelp";
import { callAi, toAiTask } from "@/state/ai";
import { useStage } from "@/state/hooks";
import { useMios } from "@/state/store";
import { Button, Dialog } from "@/ui/primitives";
import s from "./assist.module.css";

const LEAD = {
  child: "Ask AI to suggest steps, then change them however you like. Or write your own.",
  teen: "Split it yourself first. Then AI can check your steps; it won't rewrite them.",
  adult: "Split it into steps you can finish one at a time.",
} as const;

/**
 * B6: task breakdown. Child: AI splits the task. Teen: the user splits it
 * and AI only checks. Adult: the user splits it, no AI. Mount it only while
 * open (keyed by task), so each opening starts from the task's own steps.
 */
export function StepsDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const tasks = useMios((st) => st.tasks);
  const setSteps = useMios((st) => st.setSteps);
  const logAiUse = useMios((st) => st.logAiUse);
  const { stage, policy } = useStage();
  const [draft, setDraft] = useState<string[]>(() => (task.steps?.length ? task.steps.map((st) => st.title) : ["", "", ""]));
  const [suggested, setSuggested] = useState<AiStatus<BreakdownResult>>({ state: "idle" });
  const [checked, setChecked] = useState<AiStatus<CheckStepsResult>>({ state: "idle" });
  const [usedAi, setUsedAi] = useState<string[] | null>(null);

  const filled = cleanSteps(draft);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const setLine = (i: number, v: string) => setDraft((d) => d.map((x, j) => (j === i ? v : x)));

  const suggest = async () => {
    logAiUse("B6");
    setSuggested({ state: "loading" });
    const r = await callAi("breakdown", { task: toAiTask(task, byId) });
    setSuggested(r.ok ? { state: "done", result: r.result } : { state: "error", error: r.error });
  };

  const check = async () => {
    logAiUse("B6");
    setChecked({ state: "loading" });
    const r = await callAi("checkSteps", { task: toAiTask(task, byId), steps: filled });
    setChecked(r.ok ? { state: "done", result: r.result } : { state: "error", error: r.error });
  };

  const save = () => {
    // The user's own work unless they saved the AI's list exactly as it came.
    const own = !usedAi || usedAi.join("\n") !== filled.join("\n");
    setSteps(task.id, filled, own);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Steps: ${task.title}`}
      actions={
        <>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!filled.length && !task.steps?.length}>
            {filled.length || !task.steps?.length ? "Save steps" : "Remove steps"}
          </Button>
        </>
      }
    >
      <p className={s.lead}>{LEAD[stage]}</p>

      <ol className={s.draft}>
        {draft.map((line, i) => (
          <li key={i}>
            <input
              value={line}
              placeholder={i === 0 ? "First step" : "Next step"}
              aria-label={`Step ${i + 1}`}
              maxLength={200}
              onChange={(e) => setLine(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setDraft((d) => [...d.slice(0, i + 1), "", ...d.slice(i + 1)]);
                }
              }}
            />
            <Button size="sm" variant="plain" aria-label={`Remove step ${i + 1}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
              ✕
            </Button>
          </li>
        ))}
      </ol>
      <div className={s.row}>
        <Button size="sm" onClick={() => setDraft((d) => [...d, ""])} disabled={draft.length >= 20}>
          Add step
        </Button>
        {policy.aiButton && stage === "child" && (
          <Button size="sm" variant="secondary" onClick={suggest} disabled={suggested.state === "loading"}>
            <span aria-hidden>✦ </span>Suggest steps
          </Button>
        )}
        {policy.aiButton && stage === "teen" && (
          <Button size="sm" variant="secondary" onClick={check} disabled={filled.length < 2 || checked.state === "loading"}>
            <span aria-hidden>✦ </span>Check my steps
          </Button>
        )}
      </div>
      {task.repeat && <p className={s.note}>Steps belong to this day only; the next day of the repeat starts without them.</p>}

      <AiCard
        title="Suggested steps"
        status={suggested}
        why={suggested.state === "done" ? suggested.result.why : undefined}
        onClose={() => setSuggested({ state: "idle" })}
        actions={
          suggested.state === "done" && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setDraft(suggested.result.steps);
                setUsedAi(suggested.result.steps);
                setSuggested({ state: "idle" });
              }}
            >
              {filled.length ? "Replace mine with these" : "Use these"}
            </Button>
          )
        }
      >
        {suggested.state === "done" && (
          <ol className={s.aiList}>
            {suggested.result.steps.map((st) => (
              <li key={st}>{st}</li>
            ))}
          </ol>
        )}
      </AiCard>

      <AiCard
        title="AI's check"
        status={checked}
        why={checked.state === "done" ? checked.result.why : undefined}
        onClose={() => setChecked({ state: "idle" })}
      >
        {checked.state === "done" && (
          <ul className={s.aiList}>
            {checked.result.notes.map((n, i) => (
              <li key={i}>
                <strong>{n.step ? `Step ${n.step}` : "Overall"}:</strong> {n.note}
              </li>
            ))}
          </ul>
        )}
      </AiCard>
    </Dialog>
  );
}
