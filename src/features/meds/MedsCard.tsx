"use client";

import { useState } from "react";
import { dayMark, describeMed, lastDays, type DailyMed, type DayMark } from "@/core";
import { useMios } from "@/state/store";
import { Button, Card, Empty } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { MedDialog } from "./MedDialog";
import s from "./meds.module.css";

const HISTORY_DAYS = 30;

const MARK_TEXT = (m: DayMark): string => {
  switch (m.kind) {
    case "off":
      return "not scheduled";
    case "all":
      return `all taken (${m.taken} of ${m.of})`;
    case "some":
      return `some taken (${m.taken} of ${m.of})`;
    case "dismissed":
      return "reminder dismissed";
    case "missed":
      return "missed";
    case "today":
      return `today: ${m.taken} of ${m.of} so far`;
    case "logged":
      return `logged ${m.count}×`;
  }
};

/**
 * Resources: daily medicines set up as prescribed, each with its last 30
 * days. Reminders show on every mode screen; this is where they're set up.
 */
export function MedsCard({ now }: { now: number }) {
  const meds = useMios((st) => st.meds);
  const [editing, setEditing] = useState<DailyMed | "new" | null>(null);
  const [showPast, setShowPast] = useState(false);
  const active = meds.filter((m) => !m.removedAt);
  const past = meds.filter((m) => m.removedAt);

  return (
    <Card
      title="Daily medicines"
      hint="Reminders and a log, set up as prescribed. Only you decide what to take."
      action={
        <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
          Add
        </Button>
      }
    >
      {active.length ? (
        <ul className={s.medList}>
          {active.map((m) => (
            <MedRow key={m.id} med={m} now={now} onEdit={() => setEditing(m)} />
          ))}
        </ul>
      ) : (
        <Empty>No daily medicines yet. Add one to get a red note when it&apos;s time, and a record of every day.</Empty>
      )}
      {past.length > 0 && (
        <div className={s.past}>
          <Button size="sm" variant="plain" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>
            {showPast ? "Hide" : "Show"} past medicines ({past.length})
          </Button>
          {showPast && (
            <ul className={s.medList}>
              {past.map((m) => (
                <MedRow key={m.id} med={m} now={now} />
              ))}
            </ul>
          )}
        </div>
      )}
      {editing && <MedDialog key={editing === "new" ? "new" : editing.id} med={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function MedRow({ med, now, onEdit }: { med: DailyMed; now: number; onEdit?: () => void }) {
  const logs = useMios((st) => st.medLogs);
  const entries = useMios((st) => st.resourceEntries);
  const startHour = useMios((st) => st.settings.medDayStartHour ?? 0);
  const takeDose = useMios((st) => st.takeDose);
  const undoMedLog = useMios((st) => st.undoMedLog);
  const setMedPaused = useMios((st) => st.setMedPaused);
  const removeMed = useMios((st) => st.removeMed);
  const toast = useToast((t) => t.show);
  const days = lastDays(now, HISTORY_DAYS, startHour);
  const marks = days.map((d) => ({ day: d, mark: dayMark(med, d, logs, entries, now, startHour) }));
  const scheduled = marks.filter((m) => m.mark.kind !== "off" && m.mark.kind !== "logged" && m.mark.kind !== "today");
  const full = scheduled.filter((m) => m.mark.kind === "all").length;

  return (
    <li className={s.med}>
      <div className={s.medHead}>
        <span>
          <strong>💊 {med.name}</strong>
          {med.pausedAt && !med.removedAt && <span className={s.tag}>Paused</span>}
          {med.removedAt && <span className={s.tag}>Removed</span>}
        </span>
        {!med.removedAt && (
          <span className={s.medActions}>
            <Button
              size="sm"
              onClick={() => {
                const log = takeDose(med.id);
                if (log) toast(`${med.name} logged.`, "info", { label: "Undo", onClick: () => undoMedLog(log.id) });
              }}
            >
              {med.remind ? "Log an extra dose" : "Log a dose"}
            </Button>
            <Button size="sm" variant="plain" onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" variant="plain" onClick={() => setMedPaused(med.id, !med.pausedAt)}>
              {med.pausedAt ? "Resume" : "Pause"}
            </Button>
            <Button
              size="sm"
              variant="plain"
              onClick={() => confirm(`Remove ${med.name}? Reminders stop; its history stays here.`) && removeMed(med.id)}
            >
              Remove
            </Button>
          </span>
        )}
      </div>
      <p className={s.meta}>{describeMed(med)}</p>
      <div className={s.grid} role="list" aria-label={`${med.name}, last ${HISTORY_DAYS} days`}>
        {marks.map(({ day, mark }) => {
          const label = `${new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${MARK_TEXT(mark)}`;
          return <span key={day} role="listitem" className={`${s.cell} ${s[`m_${mark.kind}`]}`} title={label} aria-label={label} />;
        })}
      </div>
      {med.remind && scheduled.length > 0 && (
        <p className={s.meta}>
          All doses taken on {full} of the last {scheduled.length} scheduled days.
        </p>
      )}
      <ul className={s.legend} aria-hidden>
        <li>
          <span className={`${s.cell} ${s.m_all}`} /> all
        </li>
        <li>
          <span className={`${s.cell} ${s.m_some}`} /> some
        </li>
        <li>
          <span className={`${s.cell} ${s.m_missed}`} /> missed
        </li>
        <li>
          <span className={`${s.cell} ${s.m_dismissed}`} /> dismissed
        </li>
        <li>
          <span className={`${s.cell} ${s.m_today}`} /> today
        </li>
        <li>
          <span className={`${s.cell} ${s.m_off}`} /> not scheduled
        </li>
      </ul>
    </li>
  );
}
