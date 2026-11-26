"use client";

import { PhoneCalendar } from "./CalendarPhone";
import { CALENDAR_TODAY, fmtLength, modeOf, NOW_HOUR, type MockTask } from "./mockData";
import { useMockup, type Filter } from "./store";
import s from "./mockup.module.css";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "ready", label: "Ready" },
  { id: "blocked", label: "Blocked" },
];

const END_OF_DAY = 23;

export interface Slot {
  from: number;
  to: number;
  kind: "busy" | "task" | "free";
  title: string;
  taskId?: string;
}

/** What's left of today: calendar items, tasks with a start time, and the free gaps between them. */
export const timeline = (tasks: MockTask[]): Slot[] => {
  const taken: Slot[] = [
    ...CALENDAR_TODAY.map((c) => ({ ...c, kind: "busy" as const })),
    ...tasks
      .filter((t) => t.start !== undefined && t.state !== "done")
      .map((t) => ({ from: t.start!, to: t.start! + (t.guess ?? 30) / 60, kind: "task" as const, title: t.title, taskId: t.id })),
  ]
    .filter((x) => x.to > NOW_HOUR)
    .sort((a, b) => a.from - b.from);

  const out: Slot[] = [];
  let cursor = NOW_HOUR;
  for (const x of taken) {
    if (x.from - cursor >= 0.25) out.push({ from: cursor, to: x.from, kind: "free", title: "Free" });
    out.push(x);
    cursor = Math.max(cursor, x.to);
  }
  if (END_OF_DAY - cursor >= 0.25) out.push({ from: cursor, to: END_OF_DAY, kind: "free", title: "Free" });
  return out;
};

export function SchedulePage() {
  const m = useMockup();
  const tasks = m.data.tasks.filter(m.inMode);
  const count = (f: Filter) => (f === "all" ? tasks.filter((t) => t.state !== "done").length : tasks.filter((t) => t.state === f).length);
  const show = (state: MockTask["state"]) => m.filter === "all" || m.filter === state;
  const running = tasks.filter((t) => t.state === "running");
  const ready = tasks.filter((t) => t.state === "ready");
  const blocked = tasks.filter((t) => t.state === "blocked");

  return (
    <div className={s.page}>
      {m.aiOn && ready.length > 1 && (
        <div className={s.aiTriggers} role="group" aria-label="AI help">
          <button type="button" onClick={() => m.openSheet({ kind: "ai", feature: "order" })}>
            ✨ Suggest an order
          </button>
          <button type="button" onClick={() => m.openSheet({ kind: "ai", feature: "schedule" })}>
            ✨ Draft my day
          </button>
        </div>
      )}

      <div className={s.chips} role="tablist" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={m.filter === f.id} className={s.chip} onClick={() => m.setFilter(f.id)}>
            {f.label} <span>{count(f.id)}</span>
          </button>
        ))}
      </div>

      {m.filter === "all" && <PhoneCalendar tasks={tasks} />}

      {show("running") && running.length > 0 && <TaskGroup title="Running" tasks={running} />}
      {show("ready") && <TaskGroup title="Queue" hint="Runs top to bottom" tasks={ready} numbered empty="Nothing ready." />}
      {show("blocked") && <TaskGroup title="Blocked" tasks={blocked} empty="Nothing blocked." />}
      {m.filter === "running" && running.length === 0 && <p className={s.emptyNote}>Nothing running.</p>}
    </div>
  );
}

function TaskGroup({ title, hint, tasks, numbered, empty }: { title: string; hint?: string; tasks: MockTask[]; numbered?: boolean; empty?: string }) {
  const m = useMockup();
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <h3>{title}</h3>
        {hint && <span className={s.muted}>{hint}</span>}
      </div>
      {tasks.length ? (
        <ul className={s.taskList}>
          {tasks.map((t, k) => {
            const mode = modeOf(t.mode);
            return (
              <li key={t.id}>
                <button type="button" className={s.taskRow} onClick={() => m.openSheet({ kind: "task", id: t.id })}>
                  {numbered && <span className={s.taskNum}>{k + 1}</span>}
                  <span className={s.taskText}>
                    <strong>{t.title}</strong>
                    <span>
                      {mode.icon} P{t.priority}
                      {t.guess ? ` · ${fmtLength(t.guess)}` : ""}
                      {t.due ? ` · Due ${t.due}` : ""}
                      {t.blockedBy ? ` · Waiting on ${t.blockedBy}` : ""}
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
      ) : (
        <p className={s.emptyNote}>{empty}</p>
      )}
    </section>
  );
}
