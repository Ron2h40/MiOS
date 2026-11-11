"use client";

import { useState, type FormEvent } from "react";
import { anchorDayOf, deadlineNotAfterStart, taskProtectedConflicts, type ModeId, type ProtectedConflict, type RepeatPattern } from "@/core";
import { useBusy } from "@/state/hooks";
import { useMios } from "@/state/store";
import { Button, Card } from "@/ui/primitives";
import { InterruptDialog } from "./InterruptDialog";
import { ProtectedTimeDialog } from "./ProtectedTimeDialog";
import { TaskFields, type TaskDraft } from "./TaskFields";
import s from "./tasks.module.css";

export function TaskComposer({ mode }: { mode: ModeId }) {
  const addTask = useMios((st) => st.addTask);
  const addRepeatingTask = useMios((st) => st.addRepeatingTask);
  const settings = useMios((st) => st.settings);
  const busy = useBusy();

  const blank = (): TaskDraft => ({ title: "", mode: mode === "general" ? "daily-life" : mode, priority: 3 });
  const [draft, setDraft] = useState<TaskDraft>(blank);
  const [isInterrupt, setIsInterrupt] = useState(false);
  const [repeat, setRepeat] = useState<RepeatChoice>("none");
  const [weekDays, setWeekDays] = useState<number[]>([]);
  const [until, setUntil] = useState("");
  const [conflicts, setConflicts] = useState<ProtectedConflict[]>([]);
  const [interruptId, setInterruptId] = useState<string | null>(null);

  const create = (protectedOverride: boolean) => {
    const input = { ...draft, isInterrupt, protectedOverride: protectedOverride || undefined };
    const pattern = toPattern(repeat, weekDays.length ? weekDays : [anchorWeekday(draft)]);
    const task = pattern ? addRepeatingTask(input, pattern, until || undefined) : addTask(input);
    setDraft(blank());
    setIsInterrupt(false);
    setRepeat("none");
    setWeekDays([]);
    setUntil("");
    setConflicts([]);
    if (isInterrupt) setInterruptId(task.id);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const found = taskProtectedConflicts(draft, settings, busy);
    if (found.length) setConflicts(found);
    else create(false);
  };

  return (
    <Card title="New task" hint="You set the priority. MiOS keeps the rules.">
      <form className={s.form} onSubmit={submit}>
        <TaskFields draft={draft} onChange={setDraft} showMode={mode === "general"} />
        <div className={s.formRow}>
          <label>
            Repeat
            <select
              value={repeat}
              onChange={(e) => {
                const next = e.target.value as RepeatChoice;
                setRepeat(next);
                if (next === "weekly" && !weekDays.length) setWeekDays([anchorWeekday(draft)]);
              }}
            >
              <option value="none">Doesn&apos;t repeat</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Every weekday</option>
              <option value="weekly">Weekly on…</option>
              <option value="monthly">Monthly, same date</option>
            </select>
          </label>
          {repeat !== "none" && (
            <label>
              Until (optional)
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          )}
        </div>
        {repeat === "weekly" && (
          <div className={s.dayChips} role="group" aria-label="Repeat on">
            {DAY_LETTERS.map((d, i) => (
              <button
                key={i}
                type="button"
                className={s.dayChip}
                aria-pressed={weekDays.includes(i)}
                aria-label={DAY_FULL[i]}
                onClick={() => setWeekDays((w) => (w.includes(i) ? (w.length > 1 ? w.filter((x) => x !== i) : w) : [...w, i]))}
              >
                {d}
              </button>
            ))}
          </div>
        )}
        {repeat !== "none" && (
          <p className={s.hintText}>
            ⚠︎ This repeats exactly. If one day needs a different start or deadline, change that day&apos;s task when it
            shows up.
          </p>
        )}
        {repeat !== "none" && deadlineNotAfterStart(draft) && (
          <p className={`${s.callout} ${s.calloutWarn}`}>
            The deadline is at or before the start, so each one will count as late unless it&apos;s finished early.
          </p>
        )}
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

type RepeatChoice = "none" | "daily" | "weekdays" | "weekly" | "monthly";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekday of the day the task belongs to (its start, else its deadline, else today). */
const anchorWeekday = (draft: TaskDraft): number => {
  const [y, m, d] = anchorDayOf(draft, Date.now()).split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

const toPattern = (choice: RepeatChoice, days: number[]): RepeatPattern | null => {
  switch (choice) {
    case "none":
      return null;
    case "weekly":
      return { kind: "weekly", days };
    default:
      return { kind: choice };
  }
};
