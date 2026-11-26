"use client";

import { useState } from "react";
import { getMode, minutesBetween, RESOURCE_KEYS, type ModeId, type Task, type Wrap } from "@/core";
import { CheckInDialog } from "@/features/calendar/CheckIn";
import { MedReminders } from "@/features/meds/MedReminders";
import { RESOURCE_LABEL } from "@/features/resources/DayChart";
import { WrapViewer } from "@/features/rewards/WrapViewer";
import { StartDialog } from "@/features/tasks/TaskDialogs";
import { makeWrap, useModeTasks, useNow, useResources, useStage } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes, formatWhen, PRIORITY_LABEL } from "@/ui/format";
import { useToast } from "@/ui/toast";
import { Floater } from "./Floater";
import { useNotices, type PhoneNotice } from "./notices";
import { usePhoneUi, type PhoneFilter } from "./phoneUi";
import s from "./phone.module.css";

const clock = (minutes: number) => {
  const total = Math.max(0, Math.floor(minutes * 60));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const RING_COLOR = { focus: "var(--series-focus)", energy: "var(--series-energy)", hydration: "var(--series-hydration)" } as const;

/**
 * Phone Home: what's happening now. A due medicine, the running task (or the
 * next one), the counts, the resource rings, and one floating button for
 * everything else that needs you.
 */
export function PhoneHome({ mode }: { mode: ModeId }) {
  const now = useNow(1000);
  const nowMs = Date.parse(now);
  const { running, ready, blocked } = useModeTasks(mode);
  const settings = useMios((st) => st.settings);
  const setTaskState = useMios((st) => st.setTaskState);
  const updateTask = useMios((st) => st.updateTask);
  const { policy } = useStage();
  const toast = useToast((t) => t.show);
  const { open, showOnSchedule } = usePhoneUi.getState();
  const [starting, setStarting] = useState<Task | null>(null);
  const [checkIn, setCheckIn] = useState(false);
  const [wrap, setWrap] = useState<Wrap | null>(null);
  const saveWrap = useMios((st) => st.saveWrap);
  const notices = useNotices(mode, now);

  const move = (task: Task, to: "ready" | "done" | "running") => {
    const r = setTaskState(task.id, to);
    if (!r.ok) toast(r.error, "warn");
  };
  // Guess first: the dialog asks for a time guess (with the AI's second opinion at child and teen stage).
  const start = (task: Task) => (task.estimateMinutes && !policy.aiButton ? move(task, "running") : setStarting(task));

  const openNotice = (n: PhoneNotice) => {
    if (n.kind === "checkin") setCheckIn(true);
    else if (n.kind === "reward") setWrap(makeWrap(n.reward));
    else open({ kind: "notice", id: n.id });
  };

  const current = running[0];
  const next = ready[0];
  const counts: { state: PhoneFilter; n: number; label: string }[] = [
    { state: "running", n: running.length, label: `Running / ${settings.runningCap}` },
    { state: "ready", n: ready.length, label: "Ready" },
    { state: "blocked", n: blocked.length, label: "Blocked" },
  ];

  return (
    <>
      <div className={s.page}>
        <p className={s.dateLine}>
          {new Date(nowMs).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ·{" "}
          {new Date(nowMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {getMode(mode).label}
        </p>

        <MedReminders />

        {current ? (
          <RunningCard task={current} now={now} more={running.length - 1} onMove={move} />
        ) : next ? (
          <section className={s.nowCard}>
            <span className={`${s.nowLabel} ${s.nowLabelNext}`}>Up next</span>
            <h2 className={s.nowTitle}>{next.title}</h2>
            <TaskMeta task={next} now={nowMs} />
            <button type="button" className={`${s.bigButton} ${s.btnPrimary}`} onClick={() => start(next)}>
              ▶ Start
            </button>
          </section>
        ) : (
          <section className={`${s.nowCard} ${s.nowEmpty}`}>
            <h2 className={s.nowTitle}>Nothing queued</h2>
            <p className={s.muted}>Add something, or enjoy the free time.</p>
            <button type="button" className={`${s.bigButton} ${s.btnPrimary}`} onClick={() => open({ kind: "add" })}>
              + Add a task
            </button>
          </section>
        )}

        <div className={s.counts}>
          {counts.map((c) => (
            <button key={c.state} type="button" className={s.countTile} onClick={() => showOnSchedule(c.state)}>
              <strong className={s[`count_${c.state}`]}>{c.n}</strong>
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <h3 className={s.sectionTitle}>Resources · tap to log</h3>
        <Rings now={now} onLog={(resource) => open({ kind: "log", resource })} />
      </div>

      <Floater notices={notices} onOpen={openNotice} />

      <StartDialog
        key={starting?.id}
        task={starting}
        onStart={(est) => {
          if (starting) {
            if (est) updateTask(starting.id, { estimateMinutes: est });
            move(starting, "running");
          }
          setStarting(null);
        }}
        onClose={() => setStarting(null)}
      />
      <CheckInDialog open={checkIn} onClose={() => setCheckIn(false)} />
      {wrap && (
        <WrapViewer
          wrap={wrap}
          onClose={() => {
            saveWrap(wrap);
            setWrap(null);
          }}
        />
      )}
    </>
  );
}

function RunningCard({
  task,
  now,
  more,
  onMove,
}: {
  task: Task;
  now: string;
  more: number;
  onMove: (task: Task, to: "ready" | "done") => void;
}) {
  const spent = task.actualMinutes + (task.runningSince ? minutesBetween(task.runningSince, now) : 0);
  const over = task.estimateMinutes ? spent > task.estimateMinutes : false;
  return (
    <section className={s.nowCard}>
      <span className={s.nowLabel}>
        <span className={s.pulse} aria-hidden /> Running{more > 0 ? ` · ${more} more` : ""}
      </span>
      <h2 className={s.nowTitle}>{task.title}</h2>
      <TaskMeta task={task} now={Date.parse(now)} />
      <div className={s.timer} aria-label="Time spent">
        {clock(spent)}
      </div>
      {task.estimateMinutes && (
        <p className={`${s.guess} ${over ? s.over : ""}`}>
          Your guess {formatMinutes(task.estimateMinutes)}
          {over && " · past your guess"}
        </p>
      )}
      <div className={s.nowActions}>
        <button type="button" className={`${s.bigButton} ${s.btnSoft}`} onClick={() => onMove(task, "ready")}>
          ❚❚ Pause
        </button>
        <button type="button" className={`${s.bigButton} ${s.btnGreen}`} onClick={() => onMove(task, "done")}>
          ✓ Done
        </button>
      </div>
    </section>
  );
}

export function TaskMeta({ task, now }: { task: Task; now: number }) {
  const mode = getMode(task.mode);
  return (
    <p className={s.taskMeta}>
      {mode.icon} {mode.label} · {PRIORITY_LABEL[task.priority].split(" ")[0]}
      {task.deadline ? ` · Due ${formatWhen(task.deadline, new Date(now))}` : ""}
    </p>
  );
}

function Rings({ now, onLog }: { now: string; onLog: (k: (typeof RESOURCE_KEYS)[number]) => void }) {
  const { levels } = useResources(now);
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className={s.rings}>
      {RESOURCE_KEYS.map((k) => (
        <button key={k} type="button" className={s.ring} onClick={() => onLog(k)} aria-label={`${RESOURCE_LABEL[k]} ${levels[k]}%. Log something`}>
          <svg viewBox="0 0 76 76" width="76" height="76" aria-hidden>
            <circle cx="38" cy="38" r={r} fill="none" stroke="var(--fill)" strokeWidth="8" />
            {/* An empty ring has no arc (a zero-length round cap would still draw a dot). */}
            {levels[k] > 0 && (
            <circle
              cx="38"
              cy="38"
              r={r}
              fill="none"
              stroke={RING_COLOR[k]}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(levels[k] / 100) * c} ${c}`}
              transform="rotate(-90 38 38)"
              className={s.ringArc}
            />
            )}
            <text x="38" y="43" textAnchor="middle" className={s.ringValue}>
              {levels[k]}%
            </text>
          </svg>
          <span>{RESOURCE_LABEL[k]}</span>
        </button>
      ))}
    </div>
  );
}
