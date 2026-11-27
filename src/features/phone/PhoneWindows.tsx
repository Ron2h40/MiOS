"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ALL_MODES,
  RESOURCE_PRESETS,
  splitByDeadline,
  tasksInMode,
  todaysReminders,
  type ModeId,
  type Priority,
  type ResourceKey,
} from "@/core";
import { OrderAnswer, ScheduleAnswer, useQueueAi, type QueueAiFeature } from "@/features/ai/QueueAssist";
import { RESOURCE_LABEL } from "@/features/resources/DayChart";
import { DeadlockPanel, StarvationPanel } from "@/features/tasks/Panels";
import { TaskComposer } from "@/features/tasks/TaskComposer";
import { BlockerDialog, EditDialog, StartDialog } from "@/features/tasks/TaskDialogs";
import { MedsCard } from "@/features/meds/MedsCard";
import { useDeadlocks, useGate, useModeTasks, useNow, useStage, useStarved } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatTime, PRIORITY_LABEL } from "@/ui/format";
import { useToast } from "@/ui/toast";
import { TaskMeta } from "./PhoneHome";
import { STAGE_ICON } from "./PhoneMe";
import { usePhoneUi } from "./phoneUi";
import s from "./phone.module.css";

/** The one window open on top of the phone layout, if any. */
export function PhoneWindows({ mode }: { mode: ModeId }) {
  const w = usePhoneUi((st) => st.window);
  if (!w) return null;
  switch (w.kind) {
    case "mode":
      return <ModeSheet current={mode} />;
    case "log":
      return <LogSheet key={w.resource ?? "all"} resource={w.resource} />;
    case "notice":
      return <NoticeView id={w.id} mode={mode} />;
    case "task":
      return <TaskSheet key={w.id} id={w.id} mode={mode} />;
    case "add":
      return <AddWindow key={w.start ?? "new"} mode={mode} start={w.start} />;
    case "ai":
      return <AiWindow key={w.feature} feature={w.feature} mode={mode} />;
    case "stage":
      return <StageSheet />;
    case "meds":
      return <MedsWindow />;
  }
}

/* ---------- Frames ---------- */

export function BottomSheet({ title, children }: { title: string; children: ReactNode }) {
  const close = usePhoneUi((st) => st.close);
  return (
    <div className={s.scrim} onClick={close}>
      <div className={s.sheet} role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={s.grabber} aria-hidden />
        <div className={s.sheetHead}>
          <h2>{title}</h2>
          <button type="button" className={s.close} aria-label="Close" onClick={close}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FullScreen({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const close = usePhoneUi((st) => st.close);
  return (
    <div className={s.full} role="dialog" aria-modal aria-label={title}>
      <div className={s.fullHead}>
        <button type="button" className={s.close} aria-label="Close" onClick={close}>
          ✕
        </button>
        <h2>{title}</h2>
        <span className={s.fullAction}>{action}</span>
      </div>
      <div className={s.fullBody}>{children}</div>
    </div>
  );
}

/* ---------- Mode ---------- */

function ModeSheet({ current }: { current: ModeId }) {
  const router = useRouter();
  const tasks = useMios((st) => st.tasks);
  const close = usePhoneUi((st) => st.close);
  return (
    <BottomSheet title="Mode">
      <div className={s.optionList}>
        {ALL_MODES.map((m) => {
          const open = tasksInMode(tasks, m.id).filter((t) => t.state !== "done").length;
          return (
            <button
              key={m.id}
              type="button"
              className={s.option}
              aria-pressed={current === m.id}
              onClick={() => {
                close();
                // After the window's history step is gone, switch mode.
                setTimeout(() => router.replace(`/m/${m.id}`), 50);
              }}
            >
              <span aria-hidden>{m.icon}</span>
              <strong>{m.label}</strong>
              <span className={s.muted}>{m.id === "general" ? "Everything" : `${open} open`}</span>
            </button>
          );
        })}
      </div>
      <p className={s.footNote}>Filters Home and Schedule.</p>
    </BottomSheet>
  );
}

/* ---------- Logging ---------- */

const EARLIER = [
  { label: "Now", minutes: 0 },
  { label: "30 min ago", minutes: 30 },
  { label: "1 h ago", minutes: 60 },
  { label: "2 h ago", minutes: 120 },
];

/** A time this many minutes ago; undefined for "now". */
const minutesAgo = (minutes: number): string | undefined =>
  minutes ? new Date(Date.now() - minutes * 60_000).toISOString() : undefined;

/** Drinks and food; from a ring, only what feeds that resource. */
const itemsFor = (resource?: ResourceKey) =>
  RESOURCE_PRESETS.filter((p) => (p.kind === "drink" || p.kind === "food") && (!resource || (p.effects[resource] ?? 0) > 0));

/** A ring's items, or (from the 💊 button) today's medicines plus every drink and food. */
function LogSheet({ resource }: { resource?: ResourceKey }) {
  const now = useNow(30_000);
  const [when, setWhen] = useState(0);
  const logResource = useMios((st) => st.logResource);
  const removeResource = useMios((st) => st.removeResource);
  const takeDose = useMios((st) => st.takeDose);
  const undoMedLog = useMios((st) => st.undoMedLog);
  const meds = useMios((st) => st.meds);
  const logs = useMios((st) => st.medLogs);
  const entries = useMios((st) => st.resourceEntries);
  const startHour = useMios((st) => st.settings.medDayStartHour ?? 0);
  const close = usePhoneUi((st) => st.close);
  const toast = useToast((t) => t.show);
  const at = () => minutesAgo(EARLIER[when].minutes);
  const reminders = resource ? [] : todaysReminders(meds, logs, entries, Date.parse(now), startHour).filter((r) => r.state.kind === "due" || r.state.kind === "upcoming");

  return (
    <BottomSheet title={resource ? `Log for ${RESOURCE_LABEL[resource]}` : "Log"}>
      <div className={s.field}>
        <span>When</span>
        <div className={s.pills}>
          {EARLIER.map((e, k) => (
            <button key={e.label} type="button" aria-pressed={when === k} onClick={() => setWhen(k)}>
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {reminders.length > 0 && (
        <div className={s.medList}>
          {reminders.map((r) => (
            <div key={`${r.med.id}-${r.dose.id}`} className={s.medRow}>
              <span>
                <strong>💊 {r.med.name}</strong>
                <span className={s.muted}>{r.state.kind === "due" ? "Due now" : "Later today"}</span>
              </span>
              <button
                type="button"
                className={r.state.kind === "due" ? s.btnPrimary : s.btnSoft}
                onClick={() => {
                  const log = takeDose(r.med.id, r.dose.id, at());
                  if (log) toast(`${r.med.name} logged${when ? ` at ${formatTime(log.at)}` : ""}.`, "info", { label: "Undo", onClick: () => undoMedLog(log.id) });
                  close();
                }}
              >
                Taken
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={s.logGrid}>
        {itemsFor(resource).map((item) => (
          <button
            key={item.id}
            type="button"
            className={s.logItem}
            onClick={() => {
              const entry = logResource(item.id, { at: at() });
              toast(`${item.name} logged${when ? ` at ${formatTime(entry.at)}` : ""}.`, "info", { label: "Undo", onClick: () => removeResource(entry.id) });
              close();
            }}
          >
            <span aria-hidden>{item.icon}</span>
            {item.name}
          </button>
        ))}
      </div>
      {!resource && <p className={s.footNote}>Sleep and other medicines are in Me → Resources.</p>}
    </BottomSheet>
  );
}

/* ---------- Notices ---------- */

function NoticeView({ id, mode }: { id: string; mode: ModeId }) {
  const now = useNow(60_000);
  const tasks = useMios((st) => st.tasks);
  const settings = useMios((st) => st.settings);
  const deadlocks = useDeadlocks();
  const starved = useStarved(now);
  const { close, setTab, open } = usePhoneUi.getState();
  const ids = new Set(tasksInMode(tasks, mode).map((t) => t.id));

  if (id === "deadlock") {
    return (
      <FullScreen title="Blocking each other">
        <DeadlockPanel cycles={deadlocks.filter((c) => c.some((e) => ids.has(e.taskId)))} />
      </FullScreen>
    );
  }
  return (
    <FullScreen title="Waiting too long">
      <StarvationPanel
        flags={starved.filter((f) => ids.has(f.task.id))}
        days={settings.starvationDays}
        onStart={() => {
          close();
          setTab("home");
        }}
        onOpen={(t) => open({ kind: "task", id: t.id })}
      />
    </FullScreen>
  );
}

/* ---------- Schedule: a task's actions ---------- */

const PRIORITIES: Priority[] = [1, 2, 3, 4];

function TaskSheet({ id, mode }: { id: string; mode: ModeId }) {
  const now = useNow(60_000);
  const task = useMios((st) => st.tasks.find((t) => t.id === id));
  const tasks = useMios((st) => st.tasks);
  const { ready } = useModeTasks(mode);
  const { setTaskState, updateTask, deleteTask, moveTask, resolveBlocker, removeBlocker } = useMios.getState();
  const { policy } = useStage();
  const { close, open } = usePhoneUi.getState();
  const toast = useToast((t) => t.show);
  const [dialog, setDialog] = useState<"start" | "block" | "edit" | null>(null);

  // Deleted or finished elsewhere: nothing left to act on.
  if (!task || task.state === "done") return null;

  const move = (to: "ready" | "running" | "done") => {
    const r = setTaskState(task.id, to);
    if (!r.ok) toast(r.error, "warn");
    else close();
  };
  // Guess first, as everywhere else (with the AI's second opinion at child and teen stage).
  const start = () => (task.estimateMinutes && !policy.aiButton ? move("running") : setDialog("start"));
  const { timed, untimed } = splitByDeadline(ready);
  const section = timed.some((t) => t.id === id) ? timed : untimed;
  const pos = section.findIndex((t) => t.id === id);
  const titleOf = (taskId: string) => tasks.find((t) => t.id === taskId)?.title ?? "Deleted task";
  const active = task.blockedBy.filter((b) => (b.kind === "task" ? tasks.find((t) => t.id === b.taskId)?.state !== "done" : !b.resolved));

  return (
    <BottomSheet title={task.title}>
      <TaskMeta task={task} now={Date.parse(now)} />

      {active.length > 0 && (
        <ul className={s.blockerList} aria-label="Waiting on">
          {active.map((b) => (
            <li key={b.id}>
              <span>
                {b.kind === "task" ? "↳ " : b.kind === "person" ? "👤 " : "📅 "}
                {b.kind === "task" ? titleOf(b.taskId) : b.label}
              </span>
              {b.kind === "task" ? (
                <button type="button" onClick={() => open({ kind: "task", id: b.taskId })}>
                  Open
                </button>
              ) : (
                <button type="button" onClick={() => resolveBlocker(task.id, b.id)}>
                  Resolved
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={s.actionGrid}>
        {task.state === "running" && <ActionButton icon="❚❚" label="Pause" onClick={() => move("ready")} />}
        {task.state === "ready" && <ActionButton icon="▶" label="Start" onClick={start} />}
        {task.state !== "blocked" && <ActionButton icon="✓" label="Done" tone="green" onClick={() => move("done")} />}
        {task.state === "ready" && (
          <>
            <ActionButton icon="↑" label="Move up" disabled={pos <= 0} onClick={() => moveTask(id, "up", mode)} />
            <ActionButton icon="↓" label="Move down" disabled={pos === section.length - 1} onClick={() => moveTask(id, "down", mode)} />
          </>
        )}
        <ActionButton icon="⏸" label={task.state === "blocked" ? "Add blocker" : "Block"} onClick={() => setDialog("block")} />
        <ActionButton icon="✎" label="Edit" onClick={() => setDialog("edit")} />
        {task.blockedBy.length > 0 && active.length === 0 && (
          <ActionButton icon="✕" label="Clear blockers" onClick={() => task.blockedBy.forEach((b) => removeBlocker(task.id, b.id))} />
        )}
      </div>

      <div className={s.field}>
        <span>Priority</span>
        <div className={s.pills}>
          {PRIORITIES.map((p) => (
            <button key={p} type="button" aria-pressed={task.priority === p} onClick={() => updateTask(id, { priority: p })}>
              P{p}
            </button>
          ))}
        </div>
        <span className={s.muted}>{PRIORITY_LABEL[task.priority]}</span>
      </div>

      <button
        type="button"
        className={s.deleteRow}
        onClick={() => {
          if (!confirm(`Delete "${task.title}"?`)) return;
          close();
          deleteTask(id);
        }}
      >
        Delete task
      </button>

      <StartDialog
        key={dialog === "start" ? "start" : "idle"}
        task={dialog === "start" ? task : null}
        onStart={(est) => {
          if (est) updateTask(id, { estimateMinutes: est });
          setDialog(null);
          move("running");
        }}
        onClose={() => setDialog(null)}
      />
      <BlockerDialog key={dialog === "block" ? "block" : "idle-block"} task={dialog === "block" ? task : null} onClose={() => setDialog(null)} />
      <EditDialog key={dialog === "edit" ? "edit" : "idle-edit"} task={dialog === "edit" ? task : null} onClose={() => setDialog(null)} />
    </BottomSheet>
  );
}

function ActionButton({ icon, label, onClick, disabled, tone }: { icon: string; label: string; onClick: () => void; disabled?: boolean; tone?: "green" }) {
  return (
    <button type="button" className={`${s.action} ${tone === "green" ? s.actionGreen : ""}`} onClick={onClick} disabled={disabled}>
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}

/* ---------- Schedule: the full new-task form ---------- */

function AddWindow({ mode, start }: { mode: ModeId; start?: string }) {
  const close = usePhoneUi((st) => st.close);
  return (
    <FullScreen title="New task">
      <TaskComposer mode={mode} bare start={start} onDone={close} />
    </FullScreen>
  );
}

/* ---------- Schedule: AI help, one window per feature ---------- */

const AI_TITLE: Record<QueueAiFeature, string> = { order: "Suggest an order", schedule: "Draft my day" };

function AiWindow({ feature, mode }: { feature: QueueAiFeature; mode: ModeId }) {
  const { ready } = useModeTasks(mode);
  const close = usePhoneUi((st) => st.close);
  const ai = useQueueAi(ready, feature);

  // Closing without choosing keeps your own order or plan, as on the desktop.
  const latest = useRef(ai);
  useEffect(() => {
    latest.current = ai;
  });
  useEffect(
    () => () => {
      const a = latest.current;
      if (feature === "order" && a.order.state === "done") a.finishOrder("overridden");
      if (feature === "schedule" && a.plan.state === "done") a.finishPlan(false);
    },
    [feature],
  );

  return (
    <FullScreen title={`✨ ${AI_TITLE[feature]}`}>
      <div className={s.aiWindow}>
        {feature === "order" ? <OrderAnswer ai={ai} onDecided={close} /> : <ScheduleAnswer ai={ai} onDecided={close} />}
      </div>
    </FullScreen>
  );
}

/* ---------- Me ---------- */

function StageSheet() {
  const now = useNow(60_000);
  const { stage, policy } = useStage();
  const gate = useGate(now);
  const met = gate.signals.filter((x) => x.pass).length;
  return (
    <BottomSheet title={`${STAGE_ICON[stage]} ${policy.label} stage`}>
      <p className={s.lead}>{policy.description}</p>
      {gate.to && gate.signals.length > 0 && (
        <div className={s.noticeCard}>
          <span className={s.muted}>
            {met} of {gate.signals.length} signals for {gate.to} stage are met.
          </span>
          <div className={s.bar}>
            <span style={{ width: `${Math.round((met / gate.signals.length) * 100)}%` }} />
          </div>
        </div>
      )}
      <Link href="/progress" className={s.cardLink} onClick={() => usePhoneUi.getState().popped()}>
        See every signal in Progress ›
      </Link>
    </BottomSheet>
  );
}

function MedsWindow() {
  const now = useNow(60_000);
  return (
    <FullScreen title="Medicines">
      <MedsCard now={Date.parse(now)} />
    </FullScreen>
  );
}
