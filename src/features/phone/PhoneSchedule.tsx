"use client";

import { getMode, splitByDeadline, type ModeId, type Task } from "@/core";
import { AiHelpButton } from "@/features/ai/AiHelp";
import { useModeTasks, useNow, useStage, useStarved } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes, formatWhen } from "@/ui/format";
import { PhoneCalendar } from "./PhoneCalendar";
import { usePhoneUi, type PhoneFilter } from "./phoneUi";
import s from "./phone.module.css";

const FILTERS: { id: PhoneFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "ready", label: "Ready" },
  { id: "blocked", label: "Blocked" },
];

/**
 * Phone Schedule: AI help on top (each opens its own window), filter chips,
 * the calendar, then the queue. Every change is a tap: a task opens its
 * actions, a free gap on the calendar adds a task there, and "+" (top left)
 * opens the full new-task form.
 */
export function PhoneSchedule({ mode }: { mode: ModeId }) {
  const now = useNow(60_000);
  const { running, ready, blocked } = useModeTasks(mode);
  const filter = usePhoneUi((st) => st.filter);
  const setFilter = usePhoneUi((st) => st.setFilter);
  const open = usePhoneUi((st) => st.open);
  const { policy } = useStage();
  const starved = useStarved(now);
  const waiting = new Map(starved.map((f) => [f.task.id, f.daysWaiting]));
  const count: Record<PhoneFilter, number> = {
    all: running.length + ready.length + blocked.length,
    running: running.length,
    ready: ready.length,
    blocked: blocked.length,
  };
  const show = (f: PhoneFilter) => filter === "all" || filter === f;
  const { timed, untimed } = splitByDeadline(ready);
  const rowProps = { now, showMode: mode === "general", waiting };

  return (
    <div className={s.page}>
      {policy.aiButton && ready.length > 0 && (
        <div className={s.aiTriggers} role="group" aria-label="AI help">
          {ready.length > 1 && (
            <AiHelpButton feature="priority" label="Suggest an order" className={s.aiTrigger} onHelp={() => open({ kind: "ai", feature: "order" })} />
          )}
          <AiHelpButton feature="schedule" label="Draft my day" className={s.aiTrigger} onHelp={() => open({ kind: "ai", feature: "schedule" })} />
        </div>
      )}

      <div className={s.chips} role="tablist" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={s.chip} onClick={() => setFilter(f.id)}>
            {f.label} <span>{count[f.id]}</span>
          </button>
        ))}
      </div>

      {filter === "all" && <PhoneCalendar />}

      {show("running") && (running.length > 0 || filter === "running") && (
        <TaskGroup title="Running" tasks={running} empty="Nothing running." {...rowProps} />
      )}
      {show("ready") && (
        <section className={s.card}>
          <div className={s.cardHead}>
            <h3>Queue</h3>
            <span className={s.muted}>You set the order</span>
          </div>
          {ready.length === 0 ? (
            <p className={s.emptyNote}>Nothing ready. Tap + to add a task.</p>
          ) : (
            <>
              {/* Two lines of their own, like the desktop: each keeps its own order. */}
              {timed.length > 0 && (
                <>
                  {untimed.length > 0 && <p className={s.queueSub}>With a deadline</p>}
                  <TaskList tasks={timed} numbered {...rowProps} />
                </>
              )}
              {untimed.length > 0 && (
                <>
                  {timed.length > 0 && <p className={s.queueSub}>No deadline</p>}
                  <TaskList tasks={untimed} numbered {...rowProps} />
                </>
              )}
            </>
          )}
        </section>
      )}
      {show("blocked") && (blocked.length > 0 || filter === "blocked") && (
        <TaskGroup title="Blocked" tasks={blocked} empty="Nothing blocked." {...rowProps} />
      )}
    </div>
  );
}

interface RowProps {
  now: string;
  showMode: boolean;
  waiting: Map<string, number>;
}

function TaskGroup({ title, tasks, empty, ...rows }: { title: string; tasks: Task[]; empty: string } & RowProps) {
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <h3>{title}</h3>
      </div>
      {tasks.length ? <TaskList tasks={tasks} {...rows} /> : <p className={s.emptyNote}>{empty}</p>}
    </section>
  );
}

function TaskList({ tasks, numbered, now, showMode, waiting }: { tasks: Task[]; numbered?: boolean } & RowProps) {
  const all = useMios((st) => st.tasks);
  const open = usePhoneUi((st) => st.open);
  const titleOf = (id: string) => all.find((t) => t.id === id)?.title ?? "a deleted task";
  return (
    <ul className={s.taskList}>
      {tasks.map((t, k) => {
        const overdue = t.deadline && t.deadline < now;
        const blockers = t.blockedBy.filter((b) => (b.kind === "task" ? all.find((x) => x.id === b.taskId)?.state !== "done" : !b.resolved));
        const days = waiting.get(t.id);
        return (
          <li key={t.id}>
            <button type="button" className={s.taskRow} onClick={() => open({ kind: "task", id: t.id })}>
              {numbered && <span className={s.taskNum}>{k + 1}</span>}
              <span className={s.taskText}>
                <strong>{t.title}</strong>
                <span>
                  {showMode ? `${getMode(t.mode).icon} ` : ""}P{t.priority}
                  {t.estimateMinutes ? ` · ${formatMinutes(t.estimateMinutes)}` : ""}
                  {t.deadline && <span className={overdue ? s.late : undefined}>{` · ${overdue ? "Overdue" : "Due"} ${formatWhen(t.deadline)}`}</span>}
                  {t.scheduledStart && t.state !== "running" ? ` · Starts ${formatWhen(t.scheduledStart)}` : ""}
                  {blockers.length > 0 && ` · Waiting on ${blockers.map((b) => (b.kind === "task" ? titleOf(b.taskId) : b.label)).join(", ")}`}
                  {days !== undefined && <span className={s.late}>{` · Waiting ${days} days`}</span>}
                </span>
              </span>
              <span className={s.chevron} aria-hidden>
                ›
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
