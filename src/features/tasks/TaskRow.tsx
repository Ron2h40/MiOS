"use client";

import { useRouter } from "next/navigation";
import { getMode, seriesKeyOf, type Task } from "@/core";
import { useMios } from "@/state/store";
import { formatMinutes, formatWhen } from "@/ui/format";
import { Button, Pill, StatePill } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import s from "./tasks.module.css";

export interface RowHandlers {
  onStart: (task: Task) => void;
  onBlock: (task: Task) => void;
  onEdit: (task: Task) => void;
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
          {seriesKeyOf(task) && task.state !== "done" && (
            <span
              title={
                task.oneOff
                  ? "You changed this day of a repeating task, so MiOS keeps it until you finish or delete it."
                  : "Repeats. If it's still waiting when the next one arrives, the next one replaces it."
              }
            >
              <Pill tone={task.oneOff ? "warn" : "neutral"}>{task.oneOff ? "Edited repeat" : "↻ Repeats"}</Pill>
            </span>
          )}
          {task.protectedOverride && <Pill tone="tag">In protected time</Pill>}
          {starvedDays !== undefined && <Pill tone="warn">Waiting {starvedDays} days</Pill>}
        </div>

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
