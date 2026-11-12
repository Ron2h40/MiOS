"use client";

import { stepsProgress, type Task } from "@/core";
import { useMios } from "@/state/store";
import s from "./assist.module.css";

/** B6: a task's steps as a checklist. Ticking is instant; editing happens in the steps dialog. */
export function StepsList({ task, compact }: { task: Task; compact?: boolean }) {
  const toggleStep = useMios((st) => st.toggleStep);
  if (!task.steps?.length) return null;
  const { done, total } = stepsProgress(task);
  return (
    <div className={`${s.steps} ${compact ? s.compact : ""}`}>
      <div className={s.stepsHead}>
        Steps {done}/{total}
        <span className={s.bar} aria-hidden>
          <span style={{ width: `${(done / total) * 100}%` }} />
        </span>
      </div>
      <ul className={s.stepList}>
        {task.steps.map((st) => (
          <li key={st.id}>
            <label className={st.done ? s.stepDone : undefined}>
              <input
                type="checkbox"
                checked={st.done}
                disabled={task.state === "done"}
                onChange={() => toggleStep(task.id, st.id)}
              />
              <span>{st.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
