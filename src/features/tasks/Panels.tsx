"use client";

import type { DeadlockCycle, ModeId, ModeLoad, StarvationFlag } from "@/core";
import { useMios } from "@/state/store";
import { formatMinutes } from "@/ui/format";
import { Button, Card } from "@/ui/primitives";
import s from "./tasks.module.css";

/** A4 — show each loop and ask the user to break one link. */
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

/** A8 — glue: what every mode is costing today, so one mode sees the others. */
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

/** A5 — tasks waiting too long. */
export function StarvationPanel({ flags, days }: { flags: StarvationFlag[]; days: number }) {
  if (!flags.length) return null;
  return (
    <Card title="Waiting too long" hint={`Blocked or untouched for ${days}+ days.`}>
      <ul className={s.preview}>
        {flags.map((f) => (
          <li key={f.task.id} className={s.previewRow}>
            <span>{f.task.title}</span>
            <span>{f.daysWaiting} days</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
