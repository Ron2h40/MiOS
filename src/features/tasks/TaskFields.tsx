"use client";

import { TASK_MODES, type Priority, type TaskModeId } from "@/core";
import { fromLocalInput, PRIORITY_LABEL, toLocalInput } from "@/ui/format";
import s from "./tasks.module.css";

export interface TaskDraft {
  title: string;
  mode: TaskModeId;
  priority: Priority;
  deadline?: string;
  scheduledStart?: string;
  estimateMinutes?: number;
}

/** The shared task form fields used by the composer and the edit dialog. */
export function TaskFields({
  draft,
  onChange,
  showMode,
  autoFocus,
}: {
  draft: TaskDraft;
  onChange: (next: TaskDraft) => void;
  showMode: boolean;
  autoFocus?: boolean;
}) {
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value });

  return (
    <>
      <label>
        Task
        <input
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="What needs doing?"
          autoFocus={autoFocus}
          required
          maxLength={200}
        />
      </label>

      <div className={s.formRow}>
        {showMode && (
          <label>
            Mode
            <select value={draft.mode} onChange={(e) => set("mode", e.target.value as TaskModeId)}>
              {TASK_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Priority
          <select value={draft.priority} onChange={(e) => set("priority", Number(e.target.value) as Priority)}>
            {[1, 2, 3, 4].map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Your time guess (min)
          <input
            type="number"
            min={1}
            max={1440}
            inputMode="numeric"
            value={draft.estimateMinutes ?? ""}
            onChange={(e) => set("estimateMinutes", e.target.value ? Number(e.target.value) : undefined)}
            placeholder="e.g. 30"
          />
        </label>
        <label>
          Deadline
          <input
            type="datetime-local"
            value={toLocalInput(draft.deadline)}
            onChange={(e) => set("deadline", fromLocalInput(e.target.value))}
          />
        </label>
        <label>
          Planned start
          <input
            type="datetime-local"
            value={toLocalInput(draft.scheduledStart)}
            onChange={(e) => set("scheduledStart", fromLocalInput(e.target.value))}
          />
        </label>
      </div>
    </>
  );
}
