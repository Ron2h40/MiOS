"use client";

import { useEffect, useRef, useState } from "react";
import type { InterruptPreview, Task } from "@/core";
import type { InterruptResult } from "@/ai/types";
import { useStage } from "@/state/hooks";
import { callAi, toAiTask } from "@/state/ai";
import { useMios } from "@/state/store";
import { AiCard, AiHelpButton, type AiStatus } from "./AiHelp";
import s from "./ai.module.css";

/**
 * B3: interrupt warning. AI warns when an interrupt hurts a deadline; it
 * never picks for the user. Child: shown automatically. Teen: on request.
 * Calls `onUsed` once AI was involved, so the decision is logged as made with AI.
 */
export function InterruptAssist({
  task,
  preview,
  onUsed,
}: {
  task: Task;
  preview: InterruptPreview;
  onUsed: () => void;
}) {
  const tasks = useMios((st) => st.tasks);
  const logAiUse = useMios((st) => st.logAiUse);
  const { stage, policy } = useStage();
  const [status, setStatus] = useState<AiStatus<InterruptResult>>({ state: "idle" });
  const autoRan = useRef(false);

  const run = async () => {
    onUsed();
    setStatus({ state: "loading" });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const r = await callAi("interrupt", {
      interrupt: toAiTask(task, byId),
      interruptMinutes: preview.interruptMinutes,
      pushedBack: preview.pushedBack.slice(0, 15).map((p) => ({
        title: p.task.title,
        delayMinutes: p.delayMinutes,
        newlyLate: p.newlyLate,
        deadline: p.task.deadline,
      })),
    });
    setStatus(r.ok ? { state: "done", result: r.result } : { state: "error", error: r.error });
  };

  // Child stage: warn actively, without being asked.
  useEffect(() => {
    if (stage !== "child" || autoRan.current) return;
    autoRan.current = true;
    logAiUse("B3");
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  if (!policy.aiButton) return null;

  return (
    <>
      {stage === "teen" && status.state === "idle" && (
        <AiHelpButton feature="interrupt" label="Get an AI warning" onHelp={run} />
      )}
      <AiCard title="AI warning" status={status} why={status.state === "done" ? status.result.why : undefined}>
        {status.state === "done" && (
          <p>
            <span className={s[`severity_${status.result.severity}`]}>
              {status.result.severity === "high" ? "Risky. " : status.result.severity === "low" ? "Minor. " : "Fine. "}
            </span>
            {status.result.warning} The choice is yours.
          </p>
        )}
      </AiCard>
    </>
  );
}
