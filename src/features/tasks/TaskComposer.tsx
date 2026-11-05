"use client";

import { useState, type FormEvent } from "react";
import { taskProtectedConflicts, type ModeId, type ProtectedConflict } from "@/core";
import { useMios } from "@/state/store";
import { Button, Card } from "@/ui/primitives";
import { InterruptDialog } from "./InterruptDialog";
import { ProtectedTimeDialog } from "./ProtectedTimeDialog";
import { TaskFields, type TaskDraft } from "./TaskFields";
import s from "./tasks.module.css";

export function TaskComposer({ mode }: { mode: ModeId }) {
  const addTask = useMios((st) => st.addTask);
  const settings = useMios((st) => st.settings);

  const blank = (): TaskDraft => ({ title: "", mode: mode === "general" ? "daily-life" : mode, priority: 3 });
  const [draft, setDraft] = useState<TaskDraft>(blank);
  const [isInterrupt, setIsInterrupt] = useState(false);
  const [conflicts, setConflicts] = useState<ProtectedConflict[]>([]);
  const [interruptId, setInterruptId] = useState<string | null>(null);

  const create = (protectedOverride: boolean) => {
    const task = addTask({ ...draft, isInterrupt, protectedOverride: protectedOverride || undefined });
    setDraft(blank());
    setIsInterrupt(false);
    setConflicts([]);
    if (isInterrupt) setInterruptId(task.id);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const found = taskProtectedConflicts(draft, settings);
    if (found.length) setConflicts(found);
    else create(false);
  };

  return (
    <Card title="New task" hint="You set the priority. MiOS keeps the rules.">
      <form className={s.form} onSubmit={submit}>
        <TaskFields draft={draft} onChange={setDraft} showMode={mode === "general"} />
        <label className={s.check}>
          <input type="checkbox" checked={isInterrupt} onChange={(e) => setIsInterrupt(e.target.checked)} />
          This is an interrupt
        </label>
        <Button type="submit" variant="primary" disabled={!draft.title.trim()}>
          Add task
        </Button>
      </form>

      <ProtectedTimeDialog conflicts={conflicts} onApprove={() => create(true)} onCancel={() => setConflicts([])} />
      <InterruptDialog taskId={interruptId} onClose={() => setInterruptId(null)} />
    </Card>
  );
}
