"use client";

import { useMemo, useState } from "react";
import { taskProtectedConflicts, wouldDeadlock, type Task } from "@/core";
import { useBusy } from "@/state/hooks";
import { useMios, type NewBlocker } from "@/state/store";
import { Button, Dialog } from "@/ui/primitives";
import { EstimateAssist } from "@/features/ai/EstimateAssist";
import { TaskFields, type TaskDraft } from "./TaskFields";
import s from "./tasks.module.css";

/**
 * A9 — guess the time before starting, so MiOS can show how close guesses get.
 * B4 — at child and teen stage, AI gives a second opinion after the guess.
 */
export function StartDialog({
  task,
  onStart,
  onClose,
}: {
  task: Task | null;
  onStart: (estimateMinutes: number | undefined) => void;
  onClose: () => void;
}) {
  const [guess, setGuess] = useState(task?.estimateMinutes ? String(task.estimateMinutes) : "");
  // The guess AI compares against: set when the user finishes typing, not on every keystroke.
  const [locked, setLocked] = useState<number | undefined>(task?.estimateMinutes);
  const lock = () => setLocked(Number(guess) > 0 ? Number(guess) : undefined);

  return (
    <Dialog
      open={!!task}
      onClose={onClose}
      title="Guess first"
      actions={
        <>
          <Button variant="plain" onClick={() => onStart(undefined)}>
            Skip
          </Button>
          <Button variant="primary" disabled={!Number(guess)} onClick={() => onStart(Number(guess))}>
            Start
          </Button>
        </>
      }
    >
      <p>
        How long will <strong>{task?.title}</strong> take? MiOS times it and shows how close your guesses get.
      </p>
      <label>
        Minutes
        <input
          type="number"
          min={1}
          inputMode="numeric"
          autoFocus
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          onBlur={lock}
          onKeyDown={(e) => e.key === "Enter" && lock()}
        />
      </label>
      {task && <EstimateAssist task={task} guess={locked} />}
    </Dialog>
  );
}

/** A4 — mark a task as blocked by another task, a person or an event. */
export function BlockerDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const tasks = useMios((st) => st.tasks);
  const addBlocker = useMios((st) => st.addBlocker);
  const [kind, setKind] = useState<NewBlocker["kind"]>("task");
  const [taskId, setTaskId] = useState("");
  const [label, setLabel] = useState("");

  const candidates = useMemo(
    () =>
      tasks.filter(
        (t) =>
          task &&
          t.id !== task.id &&
          t.state !== "done" &&
          !task.blockedBy.some((b) => b.kind === "task" && b.taskId === t.id),
      ),
    [tasks, task],
  );
  const closesLoop = !!task && kind === "task" && !!taskId && wouldDeadlock(tasks, task.id, taskId);
  const valid = kind === "task" ? !!taskId : !!label.trim();

  const save = () => {
    if (!task || !valid) return;
    addBlocker(task.id, kind === "task" ? { kind, taskId } : { kind, label });
    setTaskId("");
    setLabel("");
    onClose();
  };

  return (
    <Dialog
      open={!!task}
      onClose={onClose}
      title="Blocked by…"
      actions={
        <>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            Add blocker
          </Button>
        </>
      }
    >
      <div className={s.toolbar} role="radiogroup" aria-label="Blocker type">
        {(["task", "person", "event"] as const).map((k) => (
          <Button key={k} size="sm" variant={kind === k ? "primary" : "secondary"} onClick={() => setKind(k)} aria-pressed={kind === k}>
            {k === "task" ? "A task" : k === "person" ? "A person" : "An event"}
          </Button>
        ))}
      </div>

      {kind === "task" ? (
        <label>
          Task
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">Choose a task…</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          {kind === "person" ? "Who are you waiting on?" : "What event?"}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={kind === "person" ? "e.g. Recruiter reply" : "e.g. Offer letter arrives"}
            autoFocus
          />
        </label>
      )}

      {closesLoop && (
        <p className={`${s.callout} ${s.calloutWarn}`}>
          Heads up: this closes a loop. The two tasks would wait on each other forever. You can still add it, and
          MiOS will ask you to break one link.
        </p>
      )}
    </Dialog>
  );
}

export function EditDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const updateTask = useMios((st) => st.updateTask);
  const settings = useMios((st) => st.settings);
  const busy = useBusy();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const current: TaskDraft | null =
    draft ??
    (task && {
      title: task.title,
      mode: task.mode,
      priority: task.priority,
      deadline: task.deadline,
      scheduledStart: task.scheduledStart,
      estimateMinutes: task.estimateMinutes,
    });

  const close = () => {
    setDraft(null);
    onClose();
  };

  const conflicts = current && task ? taskProtectedConflicts({ ...current, protectedOverride: task.protectedOverride && current.scheduledStart === task.scheduledStart }, settings, busy) : [];

  const save = () => {
    if (!task || !current?.title.trim()) return;
    const approve = conflicts.length > 0;
    updateTask(task.id, { ...current, protectedOverride: approve || (task.protectedOverride && current.scheduledStart === task.scheduledStart) });
    close();
  };

  return (
    <Dialog
      open={!!task}
      onClose={close}
      title="Edit task"
      actions={
        <>
          <Button variant="plain" onClick={close}>
            Cancel
          </Button>
          <Button variant={conflicts.length ? "danger" : "primary"} onClick={save} disabled={!current?.title.trim()}>
            {conflicts.length ? (conflicts[0].kind === "calendar" ? "Save into busy time" : "Save into protected time") : "Save"}
          </Button>
        </>
      }
    >
      {current && (
        <div className={s.form}>
          <TaskFields draft={current} onChange={setDraft} showMode />
          {conflicts.length > 0 && (
            <p className={`${s.callout} ${s.calloutWarn}`}>
              The planned start overlaps <strong>{conflicts[0].label}</strong>. Saving approves it.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
