"use client";

import { useEffect, useRef, useState } from "react";
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

export type QueueAiFeature = "order" | "schedule";

/**
 * B1 priority help and B2 scheduling help for the Ready queue: the requests
 * and what the user decides. `autoStart` asks right away (the phone opens a
 * window per feature, already asking).
 */
export function useQueueAi(queue: Task[], autoStart?: QueueAiFeature) {
  const tasks = useMios((st) => st.tasks);
  const settings = useMios((st) => st.settings);
  const busy = useBusy();
  const resolveAiOrder = useMios((st) => st.resolveAiOrder);
  const resolveAiSchedule = useMios((st) => st.resolveAiSchedule);

  const [order, setOrder] = useState<AiStatus<PriorityResult>>({ state: autoStart === "order" ? "loading" : "idle" });
  const [plan, setPlan] = useState<AiStatus<ScheduleResult>>({ state: autoStart === "schedule" ? "loading" : "idle" });
  const [times, setTimes] = useState<Record<string, string>>({});

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const aiTasks = queue.slice(0, 20).map((t) => toAiTask(t, byId));

  const requestOrder = () => callAi("priority", { tasks: aiTasks });
  const requestPlan = () =>
    callAi("schedule", {
      tasks: aiTasks.slice(0, 12),
      protectedBlocks: settings.protectedBlocks,
      defaultEstimateMinutes: settings.defaultEstimateMinutes,
    });
  type OrderReply = Awaited<ReturnType<typeof requestOrder>>;
  type PlanReply = Awaited<ReturnType<typeof requestPlan>>;
  const showOrder = (r: OrderReply) => setOrder(r.ok ? { state: "done", result: r.result } : { state: "error", error: r.error });
  const showPlan = (r: PlanReply) => {
    if (r.ok) setTimes(Object.fromEntries(r.result.slots.map((x) => [x.taskId, x.start])));
    setPlan(r.ok ? { state: "done", result: r.result } : { state: "error", error: r.error });
  };

  // Once per window, even when React runs effects twice in development.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    if (autoStart === "order") requestOrder().then((r) => showOrder(r));
    else requestPlan().then((r) => showPlan(r));
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askOrder = () => {
    setPlan({ state: "idle" });
    setOrder({ state: "loading" });
    void requestOrder().then(showOrder);
  };

  const askPlan = () => {
    setOrder({ state: "idle" });
    setPlan({ state: "loading" });
    void requestPlan().then(showPlan);
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

  return { byId, order, plan, times, setTimes, askOrder, askPlan, finishOrder, finishPlan, slotProblem };
}

export type QueueAi = ReturnType<typeof useQueueAi>;

/** B1 and B2 on the desktop: two buttons above the queue, answers in place. */
export function QueueAssist({ queue }: { queue: Task[] }) {
  const ai = useQueueAi(queue);
  if (!queue.length) return null;

  return (
    <>
      <div className={s.actions}>
        <AiHelpButton feature="priority" label="Suggest an order" onHelp={ai.askOrder} disabled={queue.length < 2} />
        <AiHelpButton feature="schedule" label="Draft today's schedule" onHelp={ai.askPlan} />
      </div>
      <OrderAnswer ai={ai} onClose={() => ai.finishOrder("overridden")} />
      <ScheduleAnswer ai={ai} onClose={() => ai.finishPlan(false)} />
    </>
  );
}

/** The suggested order, to use or to keep your own. `onClose` adds a Close button. */
export function OrderAnswer({ ai, onClose, onDecided }: { ai: QueueAi; onClose?: () => void; onDecided?: () => void }) {
  const { order, byId } = ai;
  const decide = (outcome: "accepted" | "overridden") => {
    ai.finishOrder(outcome);
    onDecided?.();
  };
  return (
    <AiCard
      title="Suggested order"
      status={order}
      why={order.state === "done" ? order.result.why : undefined}
      onClose={onClose}
      actions={
        <>
          <Button size="sm" variant="primary" onClick={() => decide("accepted")}>
            Use this order
          </Button>
          <Button size="sm" onClick={() => decide("overridden")}>
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
  );
}

/** The draft schedule for today, with every time editable before it's used. */
export function ScheduleAnswer({ ai, onClose, onDecided }: { ai: QueueAi; onClose?: () => void; onDecided?: () => void }) {
  const { plan, times, setTimes, byId, slotProblem } = ai;
  const decide = (apply: boolean) => {
    ai.finishPlan(apply);
    onDecided?.();
  };
  return (
    <AiCard
      title="Draft schedule for today"
      status={plan}
      why={plan.state === "done" ? plan.result.why : undefined}
      onClose={onClose}
      actions={
        plan.state === "done" && !plan.result.slots.length ? (
          <Button size="sm" onClick={() => decide(false)}>
            OK
          </Button>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={() => decide(true)}>
              Use this schedule
            </Button>
            <Button size="sm" onClick={() => decide(false)}>
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
  );
}
