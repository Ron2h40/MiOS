"use client";

import { useEffect, useState } from "react";
import {
  dayKey,
  findProtectedConflicts,
  MINUTE_MS,
  TASK_MODES,
  taskInputFromEvent,
  taskProtectedConflicts,
  type CalendarEvent,
  type TaskModeId,
} from "@/core";
import { useNow, usePendingToday } from "@/state/hooks";
import { TaskFields, type TaskDraft } from "@/features/tasks/TaskFields";
import tasks from "@/features/tasks/tasks.module.css";
import { useMios, type CalendarAnswer } from "@/state/store";
import { formatTime } from "@/ui/format";
import { Button, Dialog } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import s from "./calendar.module.css";

/** When an item happens, for a row label. */
export const eventTime = (e: Pick<CalendarEvent, "allDay" | "start" | "end">): string =>
  e.allDay ? "All day" : `${formatTime(e.start)}–${formatTime(e.end)}`;

/**
 * The morning check-in banner. Shows while today has unsorted calendar items.
 * Like the stats-drop banner, it never blocks the screen; "Later" hides it
 * until the next visit.
 */
export function CheckInBanner() {
  const now = useNow(60_000);
  const pending = usePendingToday(now);
  const [later, setLater] = useState(false);
  const [open, setOpen] = useState(false);

  if (!pending.length && !open) return null;
  return (
    <>
      {!later && !open && (
        <section className={s.banner} aria-label="Calendar check-in">
          <span aria-hidden>🗓️</span>
          <div className={s.bannerText}>
            <div className={s.bannerTitle}>
              {pending.length} calendar {pending.length === 1 ? "item" : "items"} today. Sort {pending.length === 1 ? "it" : "them"}?
            </div>
            <div className={s.bannerSub}>Add what&apos;s yours to MiOS. Everything else becomes busy time.</div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
            Sort items
          </Button>
          <Button variant="plain" size="sm" onClick={() => setLater(true)}>
            Later
          </Button>
        </section>
      )}
      <CheckInDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

type Row = {
  choice?: "task" | "busy";
  mode: TaskModeId;
  series: boolean;
  /** Optional details the user filled in; without them the task uses the item's own. */
  draft?: TaskDraft;
  showDetails?: boolean;
};

/** The task form, prefilled from the calendar item. */
const draftFrom = (e: CalendarEvent, mode: TaskModeId): TaskDraft => ({ mode, priority: 3, ...taskInputFromEvent(e) });

/** Every unsorted item for today, one row each, all in one window. */
export function CheckInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted fresh each time it opens, so the list is captured once and rows don't jump.
  return open ? <CheckInWindow onClose={onClose} /> : null;
}

function CheckInWindow({ onClose }: { onClose: () => void }) {
  const now = useNow(60_000);
  const pending = usePendingToday(now);
  const settings = useMios((st) => st.settings);
  const sortCalendarItems = useMios((st) => st.sortCalendarItems);
  const toast = useToast((t) => t.show);
  const [items] = useState<CalendarEvent[]>(pending);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [lastMode, setLastMode] = useState<TaskModeId>("daily-life");

  const row = (e: CalendarEvent): Row => rows[e.key] ?? { mode: lastMode, series: true };
  const update = (e: CalendarEvent, patch: Partial<Row>) => {
    if (patch.mode) setLastMode(patch.mode);
    setRows((r) => ({ ...r, [e.key]: { ...row(e), ...patch } }));
  };

  const answered = items.filter((e) => rows[e.key]?.choice).length;
  const skipped = items.length - answered;

  const done = () => {
    const answers: CalendarAnswer[] = items.map((e) => {
      const r = row(e);
      const d = r.draft;
      return {
        eventKey: e.key,
        choice: r.choice ?? "skip",
        scope: r.series ? "series" : "once",
        mode: d?.mode ?? r.mode,
        ...(d ? { details: { title: d.title, priority: d.priority, deadline: d.deadline, scheduledStart: d.scheduledStart, estimateMinutes: d.estimateMinutes } } : {}),
      };
    });
    const { added } = sortCalendarItems(answers);
    // All-day and "free" items never block time, so they don't count as busy.
    const busy = items.filter((e, i) => answers[i].choice !== "task" && !e.allDay && !e.free).length;
    toast(
      [added && `Added ${added} ${added === 1 ? "task" : "tasks"}`, busy && `${busy} ${busy === 1 ? "item is" : "items are"} busy time`]
        .filter(Boolean)
        .join(". ") + ".",
    );
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Today's calendar"
      actions={
        <>
          <Button variant="plain" onClick={onClose}>
            Later
          </Button>
          <Button variant="primary" onClick={done} disabled={!items.length}>
            {skipped && answered ? `Done · skip ${skipped}` : skipped ? "Skip all" : "Done"}
          </Button>
        </>
      }
    >
      <p className={s.note}>
        Is it something you&apos;ll do in MiOS? Added items become normal tasks; add details now or later. Skipped and &quot;Not MiOS&quot; items
        become busy time, so nothing gets planned on top of them.
      </p>
      <ul className={s.checkList}>
        {items.map((e) => {
          const r = row(e);
          const input = taskInputFromEvent(e);
          const minutes = Math.max(1, (Date.parse(e.end) - Date.parse(e.start)) / MINUTE_MS);
          const clash =
            r.choice !== "task"
              ? undefined
              : r.draft
                ? taskProtectedConflicts(r.draft, settings)[0]
                : input.scheduledStart
                  ? findProtectedConflicts(input.scheduledStart, minutes, settings.protectedBlocks)[0]
                  : undefined;
          return (
            <li key={e.key} className={s.checkRow}>
              <div className={s.checkHead}>
                <span className={s.time}>{eventTime(e)}</span>
                <span className={s.title}>{e.title}</span>
                {e.location && <span className={s.where}>{e.location}</span>}
              </div>
              <div className={s.choices} role="group" aria-label={`Sort ${e.title}`}>
                <button type="button" className={s.choice} aria-pressed={r.choice === "task"} onClick={() => update(e, { choice: "task" })}>
                  Add to MiOS
                </button>
                <button
                  type="button"
                  className={`${s.choice} ${s.choiceBusy}`}
                  aria-pressed={r.choice === "busy"}
                  onClick={() => update(e, { choice: "busy" })}
                >
                  Not MiOS
                </button>
                {r.choice === "task" && !r.showDetails && (
                  <label className={s.inline}>
                    Mode
                    <select
                      value={r.draft?.mode ?? r.mode}
                      onChange={(ev) => {
                        const mode = ev.target.value as TaskModeId;
                        update(e, { mode, ...(r.draft ? { draft: { ...r.draft, mode } } : {}) });
                      }}
                    >
                      {TASK_MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {r.choice === "task" && (
                  <button
                    type="button"
                    className={s.link}
                    aria-expanded={!!r.showDetails}
                    onClick={() => update(e, { showDetails: !r.showDetails, draft: r.draft ?? draftFrom(e, r.mode) })}
                  >
                    {r.showDetails ? "Hide details" : r.draft ? "Edit details" : "Add details"}
                  </button>
                )}
                {e.recurring && r.choice && (
                  <label className={s.inline}>
                    <input type="checkbox" checked={r.series} onChange={(ev) => update(e, { series: ev.target.checked })} />
                    Every time it repeats
                  </label>
                )}
              </div>
              {r.choice === "task" && r.showDetails && r.draft && (
                <div className={`${tasks.form} ${s.details}`}>
                  <TaskFields draft={r.draft} onChange={(draft) => update(e, { draft, mode: draft.mode })} showMode />
                  {e.recurring && r.series && (
                    <span className={s.note}>Mode and priority apply every time it repeats. The rest is for today&apos;s task.</span>
                  )}
                </div>
              )}
              {clash && (
                <span className={s.warn}>Overlaps {clash.label}. Adding it approves that time.</span>
              )}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

/**
 * Once a day (and on first load): prune old calendar items and make today's
 * tasks for repeating items the user always adds.
 */
export function CalendarRuntime() {
  const now = useNow(60_000);
  const day = dayKey(Date.parse(now));
  const run = useMios((st) => st.runCalendarDaily);
  const toast = useToast((t) => t.show);
  useEffect(() => {
    const n = run();
    if (n) toast(`Added ${n} repeating ${n === 1 ? "item" : "items"} from your calendar to today.`);
  }, [day, run, toast]);
  return null;
}
