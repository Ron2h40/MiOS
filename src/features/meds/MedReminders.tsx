"use client";

import { useState } from "react";
import { todaysReminders, type Reminder } from "@/core";
import { useNow } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatTime, fromLocalInput, toLocalInput } from "@/ui/format";
import { Button } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import s from "./meds.module.css";

/** "dose 2 of 3", only when there's more than one. */
const doseLabel = (r: Reminder) => (r.med.doses.length > 1 ? ` · dose ${r.index} of ${r.med.doses.length}` : "");

/**
 * Today's medicine doses, on every mode screen: a red note for each one that's
 * due, small chips for the rest. Log it, log an earlier time, or dismiss a
 * reminder that came at the wrong moment.
 */
export function MedReminders() {
  const now = useNow(30_000);
  const nowMs = Date.parse(now);
  const meds = useMios((st) => st.meds);
  const logs = useMios((st) => st.medLogs);
  const entries = useMios((st) => st.resourceEntries);
  const startHour = useMios((st) => st.settings.medDayStartHour ?? 0);
  const reminders = todaysReminders(meds, logs, entries, nowMs, startHour);
  if (!reminders.length) return null;

  const due = reminders.filter((r) => r.state.kind === "due");
  const rest = reminders.filter((r) => r.state.kind !== "due");

  return (
    <section className={s.reminders} aria-label="Medicines today">
      {due.map((r) => (
        <DueNote key={`${r.med.id}-${r.dose.id}`} r={r} />
      ))}
      {rest.length > 0 && (
        <div className={s.chips}>
          {rest.map((r) => (
            <Chip key={`${r.med.id}-${r.dose.id}`} r={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function DueNote({ r }: { r: Reminder }) {
  const takeDose = useMios((st) => st.takeDose);
  const dismissDose = useMios((st) => st.dismissDose);
  const undoMedLog = useMios((st) => st.undoMedLog);
  const toast = useToast((t) => t.show);
  const [earlier, setEarlier] = useState<string | null>(null);
  const state = r.state.kind === "due" ? r.state : null;
  const when = state
    ? state.noMeal
      ? "no meal logged yet"
      : r.dose.trigger.kind === "anytime"
        ? "today"
        : r.dose.trigger.kind === "meal"
          ? `after your meal, since ${formatTime(new Date(state.since).toISOString())}`
          : `due ${formatTime(new Date(state.since).toISOString())}`
    : "";

  const take = (at?: string) => {
    const log = takeDose(r.med.id, r.dose.id, at);
    if (log) toast(`${r.med.name} logged.`, "info", { label: "Undo", onClick: () => undoMedLog(log.id) });
  };

  return (
    <div className={s.note} role="group" aria-label={`Take ${r.med.name}`}>
      <span className={s.dot} aria-hidden />
      <span className={s.noteText}>
        <strong>💊 Take {r.med.name}</strong>
        <span>
          {when}
          {doseLabel(r)}
        </span>
      </span>
      <span className={s.noteActions}>
        {earlier === null ? (
          <>
            <Button size="sm" variant="primary" onClick={() => take()}>
              Log
            </Button>
            <Button size="sm" variant="plain" onClick={() => setEarlier(toLocalInput(new Date(Date.now() - 30 * 60_000).toISOString()))}>
              Taken earlier…
            </Button>
            <Button
              size="sm"
              variant="plain"
              title="Hide this reminder for today if it came at the wrong time"
              onClick={() => {
                dismissDose(r.med.id, r.dose.id);
                toast(`${r.med.name} reminder dismissed for today.`);
              }}
            >
              Dismiss
            </Button>
          </>
        ) : (
          <>
            <input
              type="datetime-local"
              aria-label="When you took it"
              value={earlier}
              max={toLocalInput(new Date().toISOString())}
              onChange={(e) => setEarlier(e.target.value)}
            />
            <Button size="sm" variant="primary" disabled={!earlier} onClick={() => take(fromLocalInput(earlier))}>
              Save
            </Button>
            <Button size="sm" variant="plain" onClick={() => setEarlier(null)}>
              Cancel
            </Button>
          </>
        )}
      </span>
    </div>
  );
}

function Chip({ r }: { r: Reminder }) {
  const undoMedLog = useMios((st) => st.undoMedLog);
  const st = r.state;
  if (st.kind === "taken" || st.kind === "dismissed") {
    return (
      <span className={`${s.chip} ${st.kind === "taken" ? s.chipDone : ""}`}>
        {st.kind === "taken" ? `✓ ${r.med.name} · ${formatTime(st.log.at)}` : `${r.med.name} · dismissed`}
        {doseLabel(r)}
        <button type="button" className={s.chipUndo} onClick={() => undoMedLog(st.log.id)} aria-label={`Undo ${r.med.name}`}>
          Undo
        </button>
      </span>
    );
  }
  if (st.kind !== "upcoming") return null;
  const when = st.waitingForMeal
    ? `after ${r.dose.trigger.kind === "meal" && r.dose.trigger.after !== "00:00" ? `your meal from ${r.dose.trigger.after}` : "your first meal"} (log it in Resources)`
    : st.at
      ? `due ${formatTime(new Date(st.at).toISOString())}`
      : "later";
  return (
    <span className={s.chip}>
      💊 {r.med.name} · {when}
      {doseLabel(r)}
    </span>
  );
}
