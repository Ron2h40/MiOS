"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getMode, isBigTask, keepReason, seriesKeyOf, stepsProgress, type KeepReason, type Task } from "@/core";
import { StepsList } from "@/features/assist/StepsList";
import assist from "@/features/assist/assist.module.css";
import { useMios } from "@/state/store";
import { formatMinutes, formatWhen } from "@/ui/format";
import { Button, Pill, StatePill } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import s from "./tasks.module.css";

export interface RowHandlers {
  onStart: (task: Task) => void;
  onBlock: (task: Task) => void;
  onEdit: (task: Task) => void;
  /** B6: open the steps dialog. */
  onSteps: (task: Task) => void;
  /** B5: open the research dialog. */
  onResearch: (task: Task) => void;
}

/** One task, with only the actions its process state allows. */
export function TaskRow({
  task,
  rank,
  showMode,
  starvedDays,
  now,
  queue,
  handlers,
}: {
  task: Task;
  rank?: number;
  showMode: boolean;
  starvedDays?: number;
  now: string;
  /** Present for Ready rows: enables manual reordering (A2). */
  queue?: { first: boolean; last: boolean; move: (dir: "up" | "down") => void };
  handlers: RowHandlers;
}) {
  const tasks = useMios((st) => st.tasks);
  const setTaskState = useMios((st) => st.setTaskState);
  const deleteTask = useMios((st) => st.deleteTask);
  const resolveBlocker = useMios((st) => st.resolveBlocker);
  const removeBlocker = useMios((st) => st.removeBlocker);
  const toast = useToast((st) => st.show);
  const router = useRouter();
  // Steps show open while the task is being worked on; elsewhere they fold away.
  const [stepsOpen, setStepsOpen] = useState(task.state === "running");
  const progress = stepsProgress(task);

  const move = (to: Parameters<typeof setTaskState>[1]) => {
    const r = setTaskState(task.id, to);
    if (!r.ok) toast(r.error, "warn");
  };

  const overdue = task.deadline && task.state !== "done" && task.deadline < now;
  const titleOf = (id: string) => tasks.find((t) => t.id === id)?.title ?? "Deleted task";

  return (
    <li className={s.row}>
      <span className={`${s.rank} ${task.state === "running" ? s.rankRunning : ""}`} aria-hidden>
        {task.state === "running" ? "▶" : (rank ?? "·")}
      </span>

      <div>
        <div className={`${s.title} ${task.state === "done" ? s.titleDone : ""}`}>{task.title}</div>
        <div className={s.meta}>
          <StatePill state={task.state} />
          <span>P{task.priority}</span>
          {showMode && <span>{getMode(task.mode).label}</span>}
          {task.deadline && (
            <span className={overdue ? s.metaLate : undefined}>
              {overdue ? "Overdue · " : "Due "}
              {formatWhen(task.deadline)}
            </span>
          )}
          {task.estimateMinutes && (
            <span>
              Guess {formatMinutes(task.estimateMinutes)}
              {task.actualMinutes > 0 && ` · actual ${formatMinutes(task.actualMinutes)}`}
            </span>
          )}
          {task.scheduledStart && <span>Starts {formatWhen(task.scheduledStart)}</span>}
          {task.isInterrupt && <Pill tone="tag">Interrupt</Pill>}
          {seriesKeyOf(task) && task.state !== "done" && <RepeatTag task={task} now={now} />}
          {task.protectedOverride && <Pill tone="tag">In protected time</Pill>}
          {starvedDays !== undefined && <Pill tone="warn">Waiting {starvedDays} days</Pill>}
          {progress.total > 0 && (
            <button type="button" className={assist.metaButton} aria-expanded={stepsOpen} onClick={() => setStepsOpen((o) => !o)}>
              Steps {progress.done}/{progress.total} {stepsOpen ? "▴" : "▾"}
            </button>
          )}
          {task.research?.length ? (
            <button type="button" className={assist.metaButton} onClick={() => handlers.onResearch(task)}>
              Research {task.research.length}
            </button>
          ) : null}
        </div>

        {stepsOpen && progress.total > 0 && (
          <>
            <StepsList task={task} />
            {task.state !== "done" && (
              <Button size="sm" variant="plain" onClick={() => handlers.onSteps(task)}>
                Edit steps
              </Button>
            )}
          </>
        )}

        {task.blockedBy.length > 0 && task.state !== "done" && (
          <ul className={s.blockers}>
            {task.blockedBy.map((b) => {
              const resolved = b.kind === "task" ? tasks.find((t) => t.id === b.taskId)?.state === "done" : b.resolved;
              return (
                <li key={b.id} className={s.blocker}>
                  <span className={s.blockerKind}>{b.kind}</span>
                  <span className={resolved ? s.blockerResolved : undefined}>
                    {b.kind === "task" ? titleOf(b.taskId) : b.label}
                  </span>
                  {b.kind !== "task" && !b.resolved && (
                    <Button size="sm" variant="plain" onClick={() => resolveBlocker(task.id, b.id)}>
                      Resolved
                    </Button>
                  )}
                  <Button size="sm" variant="plain" onClick={() => removeBlocker(task.id, b.id)} aria-label="Remove blocker">
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={s.actions}>
        {queue && (
          <>
            <Button variant="icon" disabled={queue.first} onClick={() => queue.move("up")} aria-label="Move up">
              ↑
            </Button>
            <Button variant="icon" disabled={queue.last} onClick={() => queue.move("down")} aria-label="Move down">
              ↓
            </Button>
          </>
        )}
        {task.state === "ready" && (
          <Button size="sm" variant="success" onClick={() => handlers.onStart(task)}>
            Start
          </Button>
        )}
        {task.state === "running" && (
          <>
            <Button size="sm" variant="primary" onClick={() => router.push(`/focus?task=${task.id}`)}>
              Focus
            </Button>
            <Button size="sm" onClick={() => move("ready")}>
              Pause
            </Button>
          </>
        )}
        {(task.state === "ready" || task.state === "running") && (
          <Button size="sm" variant="success" onClick={() => move("done")}>
            Done
          </Button>
        )}
        {/* B6: a big task without steps is offered a breakdown. */}
        {task.state !== "done" && !progress.total && isBigTask(task) && (
          <Button size="sm" onClick={() => handlers.onSteps(task)}>
            Break down
          </Button>
        )}
        {task.state !== "done" && (
          <Button size="sm" onClick={() => handlers.onBlock(task)}>
            Block
          </Button>
        )}
        {task.state === "done" ? (
          <Button size="sm" onClick={() => move("ready")}>
            Reopen
          </Button>
        ) : (
          <Button size="sm" variant="plain" onClick={() => handlers.onEdit(task)}>
            Edit
          </Button>
        )}
        <Button
          size="sm"
          variant="plain"
          onClick={() => confirm(`Delete "${task.title}"?`) && deleteTask(task.id)}
          aria-label={`Delete ${task.title}`}
        >
          ✕
        </Button>
      </div>
    </li>
  );
}

const KEEP_NOTE: Record<KeepReason, string> = {
  edited: "You changed this day of a repeating task, so MiOS keeps it until you finish or delete it.",
  running: "You're working on this day, so the next one won't replace it.",
  blocked: "This day is waiting on something, so the next one won't replace it.",
  "worked-on": "You started, paused, blocked or reopened this day, so MiOS keeps it until you finish or delete it.",
  "not-due-yet": "Repeats. Its deadline hasn't passed, so the next one won't replace it before then.",
};

/** Repeating days say whether the next day will replace them, and why not if it won't. */
function RepeatTag({ task, now }: { task: Task; now: string }) {
  const reason = keepReason(task, Date.parse(now));
  const label = reason === "edited" ? "Edited repeat" : reason === "worked-on" ? "Kept repeat" : "↻ Repeats";
  const note = reason
    ? KEEP_NOTE[reason]
    : "Repeats. If it's still waiting when the next one arrives, the next one replaces it.";
  return (
    <span title={note}>
      <Pill tone={reason === "edited" ? "warn" : "neutral"}>{label}</Pill>
    </span>
  );
}
