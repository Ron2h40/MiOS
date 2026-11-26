"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ALL_MODES, RESOURCE_PRESETS, tasksInMode, todaysReminders, type ModeId, type ResourceKey } from "@/core";
import { RESOURCE_LABEL } from "@/features/resources/DayChart";
import { DeadlockPanel, StarvationPanel } from "@/features/tasks/Panels";
import { useDeadlocks, useNow, useStarved } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatTime } from "@/ui/format";
import { useToast } from "@/ui/toast";
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
  const { close, setTab } = usePhoneUi.getState();
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
        onOpen={() => {
          close();
          setTab("schedule");
        }}
      />
    </FullScreen>
  );
}
