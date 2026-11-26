"use client";

import { useState } from "react";
import { minutesFromParts, partsFromMinutes, timeCheckDue, type Task, type TimeCheckPlace } from "@/core";
import { useNow } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes } from "@/ui/format";
import { Button, Dialog } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import s from "./assist.module.css";

/** Hours and minutes typed in two small boxes. */
export function useTimeTaken(initialMinutes: number) {
  const start = partsFromMinutes(initialMinutes);
  const [hours, setHours] = useState(String(start.hours));
  const [minutes, setMinutes] = useState(String(start.minutes));
  return { hours, minutes, setHours, setMinutes, total: minutesFromParts(hours, minutes) };
}

export function TimeTakenFields({
  label,
  time,
}: {
  label: string;
  time: ReturnType<typeof useTimeTaken>;
}) {
  return (
    <fieldset className={s.timeTaken}>
      <legend className={s.label}>{label}</legend>
      <label>
        <input
          type="number"
          min={0}
          max={168}
          inputMode="numeric"
          value={time.hours}
          onChange={(e) => time.setHours(e.target.value)}
          aria-label="Hours"
        />
        h
      </label>
      <label>
        <input
          type="number"
          min={0}
          max={59}
          inputMode="numeric"
          value={time.minutes}
          onChange={(e) => time.setMinutes(e.target.value)}
          aria-label="Minutes"
        />
        min
      </label>
    </fieldset>
  );
}

export const ON_TIME_NOTE = "On time or late stays as it was when you clicked finish.";

/** History: correct how long a finished task took. */
export function EditTimeDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const check = useMios((st) => st.checkTaskTime);
  const toast = useToast((t) => t.show);
  const time = useTimeTaken(task.actualMinutes);

  const save = () => {
    if (time.total === null) return;
    const r = check(task.id, time.total, "history");
    if (!r.ok) toast(r.error, "warn");
    else onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Time it took: ${task.title}`}
      actions={
        <>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={time.total === null}>
            Save
          </Button>
        </>
      }
    >
      <p className={s.lead}>
        MiOS counted {formatMinutes(task.actualMinutes)} while this task was Running
        {task.estimateMinutes ? `, against your guess of ${formatMinutes(task.estimateMinutes)}` : ""}. If it was left running by
        mistake, put in how long it really took. Your time guesses learn from the new time.
      </p>
      <TimeTakenFields label="How long it really took" time={time} />
      <p className={s.note}>{ON_TIME_NOTE}</p>
    </Dialog>
  );
}

/**
 * After a task that took twice its guess or more is finished: was finish
 * clicked late? Mounted once in the app shell, so it also catches a task
 * finished in Focus. Shown before the look-back questions.
 */
export function TimeCheckRuntime() {
  const now = useNow(30_000);
  const tasks = useMios((st) => st.tasks);
  const events = useMios((st) => st.events);
  const due = timeCheckDue(tasks, events, Date.parse(now));
  if (!due) return null;
  return <TimeCheckDialog key={due.id} task={due} />;
}

function TimeCheckDialog({ task }: { task: Task }) {
  const check = useMios((st) => st.checkTaskTime);
  const toast = useToast((t) => t.show);
  const time = useTimeTaken(task.actualMinutes);

  const answer = (minutes: number | null, where: TimeCheckPlace = "finish_check") => {
    const r = check(task.id, minutes, where);
    if (!r.ok) toast(r.error, "warn");
  };

  return (
    <Dialog
      open
      onClose={() => answer(null)}
      title="Did you forget to click finish?"
      actions={
        <>
          <Button variant="plain" onClick={() => answer(null)}>
            Skip
          </Button>
          <Button variant="primary" onClick={() => time.total !== null && answer(time.total)} disabled={time.total === null}>
            Save
          </Button>
        </>
      }
    >
      <p className={s.lead}>
        <strong>{task.title}</strong> was Running for {formatMinutes(task.actualMinutes)}, and you guessed{" "}
        {formatMinutes(task.estimateMinutes ?? 0)}. If you finished earlier and forgot to click finish, put in how long it
        really took.
      </p>
      <TimeTakenFields label="How long it really took" time={time} />
      <p className={s.note}>{ON_TIME_NOTE}</p>
    </Dialog>
  );
}
