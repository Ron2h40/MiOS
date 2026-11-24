"use client";

import { useState } from "react";
import { findProtectedConflicts, type Task } from "@/core";
import type { PriorityResult, ScheduleResult } from "@/ai/types";
import { callAi, toAiTask } from "@/state/ai";
import { useBusy } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatTime } from "@/ui/format";
import { Button } from "@/ui/primitives";
import { AiCard, AiHelpButton, type AiStatus } from "./AiHelp";
import s from "./ai.module.css";

/** Today's date at a local "HH:MM", as ISO. */
const todayAt = (hhmm: string): string => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/**
 * B1 priority help and B2 scheduling help for the Ready queue.
 * AI suggests; the user confirms or changes. Nothing applies on its own.
 */
export function QueueAssist({ queue }: { queue: Task[] }) {
  const tasks = useMios((st) => st.tasks);
  const settings = useMios((st) => st.settings);
  const busy = useBusy();
  const resolveAiOrder = useMios((st) => st.resolveAiOrder);
  const resolveAiSchedule = useMios((st) => st.resolveAiSchedule);

  const [order, setOrder] = useState<AiStatus<PriorityResult>>({ state: "idle" });
  const [plan, setPlan] = useState<AiStatus<ScheduleResult>>({ state: "idle" });
  const [times, setTimes] = useState<Record<string, string>>({});

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const aiTasks = queue.slice(0, 20).map((t) => toAiTask(t, byId));

  const askOrder = async () => {
    setPlan({ state: "idle" });
    setOrder({ state: "loading" });
    const r = await callAi("priority", { tasks: aiTasks });
    setOrder(r.ok ? { state: "done", result: r.result } : { state: "error", error: r.error });
  };

  const askPlan = async () => {
    setOrder({ state: "idle" });
    setPlan({ state: "loading" });
    const r = await callAi("schedule", {
      tasks: aiTasks.slice(0, 12),
      protectedBlocks: settings.protectedBlocks,
      defaultEstimateMinutes: settings.defaultEstimateMinutes,
    });
    if (r.ok) setTimes(Object.fromEntries(r.result.slots.map((x) => [x.taskId, x.start])));
    setPlan(r.ok ? { state: "done", result: r.result } : { state: "error", error: r.error });
  };

  const finishOrder = (outcome: "accepted" | "overridden") => {
    if (order.state === "done") resolveAiOrder(order.result.order, outcome);
    setOrder({ state: "idle" });
  };

  /** A slot the referee would refuse (protected time) or that's already past. */
  const slotProblem = (taskId: string, hhmm: string): string | null => {
    if (!/^\d\d:\d\d$/.test(hhmm)) return "Pick a time";
    const iso = todayAt(hhmm);
    if (new Date(iso).getTime() < Date.now() - 60_000) return "Already past";
    const t = byId.get(taskId);
    const conflict = findProtectedConflicts(iso, t?.estimateMinutes ?? settings.defaultEstimateMinutes, settings.protectedBlocks, busy)[0];
    return conflict ? `In ${conflict.label}` : null;
  };

  const finishPlan = (apply: boolean) => {
    if (plan.state !== "done") return;
    if (!apply) {
      resolveAiSchedule([], "overridden");
    } else {
      const edited = plan.result.slots.some((x) => times[x.taskId] !== x.start);
      const starts = Object.entries(times)
        .filter(([id, hhmm]) => !slotProblem(id, hhmm))
        .map(([taskId, hhmm]) => ({ taskId, start: todayAt(hhmm) }));
      resolveAiSchedule(starts, edited ? "overridden" : "accepted");
    }
    setPlan({ state: "idle" });
  };

  if (!queue.length) return null;

  return (
    <>
      <div className={s.actions}>
        <AiHelpButton feature="priority" label="Suggest an order" onHelp={askOrder} disabled={queue.length < 2} />
        <AiHelpButton feature="schedule" label="Draft today's schedule" onHelp={askPlan} />
      </div>

      <AiCard
        title="Suggested order"
        status={order}
        why={order.state === "done" ? order.result.why : undefined}
        onClose={() => finishOrder("overridden")}
        actions={
          <>
            <Button size="sm" variant="primary" onClick={() => finishOrder("accepted")}>
              Use this order
            </Button>
            <Button size="sm" onClick={() => finishOrder("overridden")}>
              Keep my order
            </Button>
          </>
        }
      >
        {order.state === "done" && (
          <ol className={s.list}>
            {order.result.order.map((id, i) => (
              <li key={id} className={s.item}>
                <span className={s.num}>{i + 1}</span>
                <span>
                  {byId.get(id)?.title ?? "Unknown task"}
                  {order.result.reasons.find((r) => r.taskId === id) && (
                    <span className={s.sub}>{order.result.reasons.find((r) => r.taskId === id)!.why}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </AiCard>

      <AiCard
        title="Draft schedule for today"
        status={plan}
        why={plan.state === "done" ? plan.result.why : undefined}
        onClose={() => finishPlan(false)}
        actions={
          plan.state === "done" && !plan.result.slots.length ? (
            <Button size="sm" onClick={() => finishPlan(false)}>
              OK
            </Button>
          ) : (
            <>
              <Button size="sm" variant="primary" onClick={() => finishPlan(true)}>
                Use this schedule
              </Button>
              <Button size="sm" onClick={() => finishPlan(false)}>
                Keep my plan
              </Button>
            </>
          )
        }
      >
        {plan.state === "done" && !plan.result.slots.length && (
          <p className={s.lead}>Nothing fits in the time left today, so there&apos;s no schedule to suggest.</p>
        )}
        {plan.state === "done" && plan.result.slots.length > 0 && (
          <>
            <p className={s.lead}>
              Edit any time before you use it. Using it sets these start times and puts your queue in this order. Slots in
              protected time or in the past are skipped.
            </p>
            <ol className={s.list}>
              {plan.result.slots.map((x) => {
                const problem = slotProblem(x.taskId, times[x.taskId] ?? "");
                return (
                  <li key={x.taskId} className={`${s.item} ${problem ? s.warnItem : ""}`}>
                    <span className={s.num} aria-hidden>
                      ◷
                    </span>
                    <span>
                      {byId.get(x.taskId)?.title ?? "Unknown task"}
                      {problem && <span className={s.sub}>{problem}: won&apos;t be applied</span>}
                      {!problem && byId.get(x.taskId)?.scheduledStart && (
                        <span className={s.sub}>Currently {formatTime(byId.get(x.taskId)!.scheduledStart!)}</span>
                      )}
                    </span>
                    <input
                      type="time"
                      className={s.timeInput}
                      aria-label={`Start time for ${byId.get(x.taskId)?.title}`}
                      value={times[x.taskId] ?? ""}
                      onChange={(e) => setTimes((t) => ({ ...t, [x.taskId]: e.target.value }))}
                    />
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </AiCard>
    </>
  );
}
