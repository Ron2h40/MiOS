"use client";

import { useEffect, useRef, useState } from "react";
import { fixedReviewQuestions, reviewDue, stepsProgress, timeCheckDue, timeChecked, type Task } from "@/core";
import { ON_TIME_NOTE, TimeTakenFields, useTimeTaken } from "./TimeTaken";
import { WhyButton } from "@/features/ai/AiHelp";
import { callAi, toAiTask } from "@/state/ai";
import { useNow, useStage } from "@/state/hooks";
import { useMios } from "@/state/store";
import { Button, Dialog } from "@/ui/primitives";
import s from "./assist.module.css";

/**
 * B7: after a big task is finished, a few reflection questions. Mounted once
 * in the app shell, so it also catches a task finished in Focus. Answers are
 * optional and never graded; skipping is remembered so it isn't asked again.
 */
export function ReviewRuntime() {
  const now = useNow(30_000);
  const tasks = useMios((st) => st.tasks);
  const events = useMios((st) => st.events);
  const [closed, setClosed] = useState<string[]>([]);
  const at = Date.parse(now);
  const due = reviewDue(tasks, events, at);
  // The "forgot to click finish?" check comes first; the look-back waits for it.
  if (!due || closed.includes(due.id) || timeCheckDue(tasks, events, at)) return null;
  return <ReviewDialog key={due.id} task={due} onClose={() => setClosed((c) => [...c, due.id])} />;
}

type Questions = { state: "loading" } | { state: "ready"; questions: string[]; ai: boolean; why?: string };

function ReviewDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const tasks = useMios((st) => st.tasks);
  const events = useMios((st) => st.events);
  const saveReview = useMios((st) => st.saveReview);
  const logAiUse = useMios((st) => st.logAiUse);
  const { policy } = useStage();
  const reviewed = tasks.filter((t) => t.review && !t.review.skipped).length;
  const [q, setQ] = useState<Questions>(() =>
    policy.aiButton ? { state: "loading" } : { state: "ready", questions: fixedReviewQuestions(reviewed), ai: false },
  );
  const [answers, setAnswers] = useState<string[]>([]);
  const asked = useRef(false);
  const checkTaskTime = useMios((st) => st.checkTaskTime);
  // Already answered in the "forgot to click finish?" check? Then don't ask about the time again.
  const [askTime] = useState(() => !timeChecked(task));
  const time = useTimeTaken(task.actualMinutes);

  useEffect(() => {
    if (asked.current || !policy.aiButton) return;
    asked.current = true;
    logAiUse("B7");
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const done = [...events].reverse().find((e) => e.type === "task_completed" && e.taskId === task.id);
    const { done: stepsDone, total: stepsTotal } = stepsProgress(task);
    void callAi("review", {
      task: {
        ...toAiTask(task, byId),
        stepsDone,
        stepsTotal,
        onTime: done?.type === "task_completed" ? done.onTime : null,
      },
    }).then((r) =>
      // No AI answer? The plain questions still work.
      setQ(
        r.ok
          ? { state: "ready", questions: r.result.questions, ai: true, why: r.result.why }
          : { state: "ready", questions: fixedReviewQuestions(reviewed), ai: false },
      ),
    );
    // Asked once per opening, with the task as it was when finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (skipped: boolean) => {
    // A changed time is saved like any correction; an untouched one isn't logged.
    if (!skipped && askTime && time.total !== null && time.total !== Math.round(task.actualMinutes)) {
      checkTaskTime(task.id, time.total, "review");
    }
    const questions = q.state === "ready" ? q.questions : [];
    saveReview(task.id, {
      answers: questions.map((question, i) => ({ question, answer: skipped ? "" : (answers[i] ?? "") })),
      ai: q.state === "ready" && q.ai,
      ...(skipped ? { skipped: true } : {}),
    });
    onClose();
  };

  return (
    <Dialog
      open
      onClose={() => finish(true)}
      title={`Look back: ${task.title}`}
      actions={
        <>
          <Button variant="plain" onClick={() => finish(true)}>
            Skip
          </Button>
          <Button variant="primary" onClick={() => finish(false)} disabled={q.state !== "ready"}>
            Save
          </Button>
        </>
      }
    >
      <p className={s.lead}>A big one is done. A few questions about how it went. No grades; answer any you like.</p>
      {askTime && task.actualMinutes >= 1 && (
        <>
          <TimeTakenFields label="Time it took (change it if the task was left running)" time={time} />
          <p className={s.note}>{ON_TIME_NOTE}</p>
        </>
      )}
      {q.state === "loading" ? (
        <p className={s.note}>Thinking of questions…</p>
      ) : (
        <>
          <ol className={s.review}>
            {q.questions.map((question, i) => (
              <li key={question}>
                <label>
                  <span>{question}</span>
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={answers[i] ?? ""}
                    onChange={(e) => setAnswers((a) => Object.assign([...a], { [i]: e.target.value }))}
                  />
                </label>
              </li>
            ))}
          </ol>
          {q.ai && q.why && (
            <div className={s.row}>
              <WhyButton why={q.why} />
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
