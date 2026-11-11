"use client";

import { useMemo, useRef } from "react";
import { MINUTE_MS, previewInterrupt, readyQueue, remainingMinutes, toIso } from "@/core";
import { InterruptAssist } from "@/features/ai/InterruptAssist";
import { useMios } from "@/state/store";
import { formatMinutes, formatWhen } from "@/ui/format";
import { Button, Dialog, Empty } from "@/ui/primitives";
import s from "./tasks.module.css";

/**
 * A3: shows what an interrupt would push back. MiOS never reorders on its
 * own: the user picks "run it first" or "add to queue".
 */
export function InterruptDialog({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const tasks = useMios((st) => st.tasks);
  const est = useMios((st) => st.settings.defaultEstimateMinutes);
  const decideInterrupt = useMios((st) => st.decideInterrupt);
  // Did AI help with this decision? Then it's logged as made with AI.
  const usedAi = useRef(false);

  const preview = useMemo(() => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;
    // The interrupt would start once whatever is Running now finishes.
    const runningLeft = tasks
      .filter((t) => t.state === "running")
      .reduce((sum, t) => sum + remainingMinutes(t, est), 0);
    // Time is read once per dialog open; good enough for a preview.
    // eslint-disable-next-line react-hooks/purity
    const startAt = toIso(Date.now() + runningLeft * MINUTE_MS);
    return { task, ...previewInterrupt(readyQueue(tasks), task, startAt, est) };
  }, [tasks, taskId, est]);

  const decide = (decision: "run_first" | "queue") => {
    if (taskId) decideInterrupt(taskId, decision, usedAi.current);
    usedAi.current = false;
    onClose();
  };

  return (
    <Dialog
      open={!!taskId && !!preview}
      onClose={() => decide("queue")}
      title="Interrupt check"
      actions={
        <>
          <Button variant="plain" onClick={() => decide("queue")}>
            Add to queue
          </Button>
          <Button variant="primary" onClick={() => decide("run_first")}>
            Run it first
          </Button>
        </>
      }
    >
      {preview && (
        <>
          <p>
            Running <strong>{preview.task.title}</strong> first takes about {formatMinutes(preview.interruptMinutes)}.
            {preview.newlyLateCount > 0 ? (
              <>
                {" "}
                <strong style={{ color: "var(--red)" }}>
                  {preview.newlyLateCount} task{preview.newlyLateCount === 1 ? "" : "s"} would miss a deadline.
                </strong>
              </>
            ) : (
              " No deadlines would slip."
            )}
          </p>
          {preview.pushedBack.length === 0 ? (
            <Empty>Nothing is waiting in your queue, so nothing gets pushed back.</Empty>
          ) : (
            <ul className={s.preview} aria-label="Tasks pushed back">
              {preview.pushedBack.map((p) => (
                <li key={p.task.id} className={`${s.previewRow} ${p.newlyLate ? s.previewLate : ""}`}>
                  <span>{p.task.title}</span>
                  <span>
                    +{formatMinutes(p.delayMinutes)} → {formatWhen(p.finishAfter)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <InterruptAssist key={preview.task.id} task={preview.task} preview={preview} onUsed={() => (usedAi.current = true)} />
        </>
      )}
    </Dialog>
  );
}
