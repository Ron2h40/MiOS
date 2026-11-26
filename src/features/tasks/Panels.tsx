"use client";

import { useState } from "react";
import {
  snoozeLabel,
  WAITING_SNOOZE_CHOICES,
  waitingReason,
  type DeadlockCycle,
  type ModeId,
  type ModeLoad,
  type StarvationFlag,
  type Task,
} from "@/core";
import { useMios } from "@/state/store";
import { formatMinutes } from "@/ui/format";
import { Button, Card } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import s from "./tasks.module.css";

/** A4: show each loop and ask the user to break one link. */
export function DeadlockPanel({ cycles }: { cycles: DeadlockCycle[] }) {
  const tasks = useMios((st) => st.tasks);
  const removeBlocker = useMios((st) => st.removeBlocker);
  if (!cycles.length) return null;
  const title = (id: string) => tasks.find((t) => t.id === id)?.title ?? "?";

  return (
    <Card title="Deadlock found" hint="These tasks wait on each other, so none can start. Break one link.">
      <div className={s.stack}>
        {cycles.map((cycle, i) => (
          <div key={i} className={`${s.callout} ${s.calloutWarn}`}>
            <strong>Loop of {cycle.length}</strong>
            <div className={s.loop}>
              {cycle.map((edge) => (
                <div key={edge.blockerId} className={s.loopLink}>
                  <span>
                    <strong>{title(edge.taskId)}</strong> waits on <strong>{title(edge.blockedByTaskId)}</strong>
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => removeBlocker(edge.taskId, edge.blockerId, { breakingDeadlock: cycle.length })}
                  >
                    Break
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** A8 glue: what every mode is costing today, so one mode sees the others. */
export function ModeLoadPanel({ load, current }: { load: ModeLoad[]; current: ModeId }) {
  const max = Math.max(60, ...load.map((l) => l.plannedMinutes));
  return (
    <Card title="Across your modes" hint="One day, shared by every mode.">
      <ul className={s.load}>
        {load.map((l) => (
          <li key={l.mode.id} className={`${s.loadRow} ${l.mode.id === current ? s.loadCurrent : ""}`}>
            <span>
              {l.mode.icon} {l.mode.label}
            </span>
            <span>
              {formatMinutes(l.plannedMinutes)}
              {l.dueSoon > 0 && ` · ${l.dueSoon} due soon`}
            </span>
            <div className={s.loadBar} aria-hidden>
              <div className={s.loadFill} style={{ width: `${(l.plannedMinutes / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * A5: tasks waiting too long, each with buttons for what it's waiting on
 * (a person, an event, another task, or nothing: just left untouched).
 */
export function StarvationPanel({
  flags,
  days,
  onStart,
  onOpen,
}: {
  flags: StarvationFlag[];
  days: number;
  onStart: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const tasks = useMios((st) => st.tasks);
  if (!flags.length) return null;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  return (
    <Card title="Waiting too long" hint={`Blocked or untouched for ${days}+ days.`}>
      <ul className={s.waitingList}>
        {flags.map((f) => (
          <WaitingRow key={f.task.id} flag={f} byId={byId} onStart={onStart} onOpen={onOpen} />
        ))}
      </ul>
    </Card>
  );
}

function WaitingRow({
  flag: { task, daysWaiting },
  byId,
  onStart,
  onOpen,
}: {
  flag: StarvationFlag;
  byId: ReadonlyMap<string, Task>;
  onStart: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const { resolveBlocker, moveToTop, snoozeWaiting } = useMios.getState();
  const toast = useToast((t) => t.show);
  const [choosing, setChoosing] = useState(false);
  const why = waitingReason(task, byId);
  const blocking = why.kind === "task" ? byId.get(why.taskId) : undefined;

  const remind = (d: number) => {
    snoozeWaiting(task.id, d);
    toast(`OK. MiOS will remind you about "${task.title}" in ${snoozeLabel(d)}.`);
  };

  return (
    <li className={s.waitingRow}>
      <div>
        <strong>{task.title}</strong>
        <span>
          {why.kind === "untouched"
            ? `Ready but untouched for ${daysWaiting} days`
            : `Waiting ${daysWaiting} days on ${why.kind === "task" ? `"${why.title}"` : why.label}`}
        </span>
      </div>
      {choosing ? (
        <div className={s.waitingActions} role="group" aria-label="Remind me in">
          <span className={s.waitingAsk}>Remind me in</span>
          {WAITING_SNOOZE_CHOICES.map((d) => (
            <Button key={d} size="sm" onClick={() => remind(d)}>
              {snoozeLabel(d)}
            </Button>
          ))}
          <Button size="sm" variant="plain" onClick={() => setChoosing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className={s.waitingActions}>
          {(why.kind === "person" || why.kind === "event") && (
            <Button size="sm" variant="primary" onClick={() => resolveBlocker(task.id, why.blockerId)}>
              {why.kind === "person" ? "They replied: unblock it" : "It happened: unblock it"}
            </Button>
          )}
          {blocking && (
            <Button size="sm" variant="primary" onClick={() => onOpen(blocking)}>
              Open that task
            </Button>
          )}
          {why.kind === "untouched" && (
            <>
              <Button size="sm" variant="primary" onClick={() => onStart(task)}>
                Start it
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  moveToTop(task.id);
                  toast(`"${task.title}" is first in the queue.`);
                }}
              >
                Move to the top
              </Button>
            </>
          )}
          <Button size="sm" variant="plain" onClick={() => setChoosing(true)}>
            Remind me in…
          </Button>
        </div>
      )}
    </li>
  );
}
