"use client";

import { useState, type ReactNode } from "react";
import { TaskMeta } from "./MainPage";
import {
  CHECKIN_ITEMS,
  fmtLength,
  LOG_ITEMS,
  MODES,
  PRIORITY,
  RESOURCES,
  type MockMode,
  type MockTask,
  type ResourceId,
} from "./mockData";
import { useMockup, type Draft, type Sheet, type SubPage } from "./store";
import s from "./mockup.module.css";

/** Whichever window is open. Only one at a time; the back gesture closes it. */
export function Sheets() {
  const m = useMockup();
  const sh = m.sheet;
  if (!sh) return null;
  switch (sh.kind) {
    case "mode":
      return <ModeSheet />;
    case "account":
      return <AccountSheet />;
    case "add":
      return <AddSheet key={sh.editId ?? "new"} editId={sh.editId} />;
    case "task":
      return <TaskSheet id={sh.id} />;
    case "block":
      return <BlockSheet id={sh.id} />;
    case "log":
      return <LogSheet key={sh.resource ?? "all"} resource={sh.resource} />;
    case "earlier":
      return <EarlierSheet medId={sh.medId} />;
    case "notice":
      return <NoticeView id={sh.id} />;
    case "page":
      return <SubPageView page={sh.page} />;
    case "timecheck":
    case "fixtime":
      return <TimeSheet key={sh.id} sheet={sh} />;
  }
}

/* ---------- Frames ---------- */

function BottomSheet({ title, children }: { title: string; children: ReactNode }) {
  const m = useMockup();
  return (
    <div className={s.scrim} onClick={m.closeSheet}>
      <div className={s.sheet} role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={s.grabber} aria-hidden />
        <div className={s.sheetHead}>
          <h2>{title}</h2>
          <button type="button" className={s.close} aria-label="Close" onClick={m.closeSheet}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FullScreen({ title, action, children, onClose }: { title: string; action?: ReactNode; children: ReactNode; onClose?: () => void }) {
  const m = useMockup();
  return (
    <div className={s.full} role="dialog" aria-modal aria-label={title}>
      <div className={s.fullHead}>
        <button type="button" className={s.close} aria-label="Close" onClick={onClose ?? m.closeSheet}>
          ✕
        </button>
        <h2>{title}</h2>
        <span className={s.fullAction}>{action}</span>
      </div>
      <div className={s.fullBody}>{children}</div>
    </div>
  );
}

/* ---------- Header buttons ---------- */

function ModeSheet() {
  const m = useMockup();
  return (
    <BottomSheet title="Mode">
      <div className={s.optionList}>
        {MODES.map((mode) => {
          const open = m.data.tasks.filter((t) => t.state !== "done" && (mode.id === "general" || t.mode === mode.id)).length;
          return (
            <button
              key={mode.id}
              type="button"
              className={s.option}
              aria-pressed={m.mode === mode.id}
              onClick={() => {
                m.setMode(mode.id);
                m.closeSheet();
              }}
            >
              <span aria-hidden>{mode.icon}</span>
              <strong>{mode.label}</strong>
              <span className={s.muted}>{mode.id === "general" ? "Everything" : `${open} open`}</span>
            </button>
          );
        })}
      </div>
      <p className={s.footNote}>Filters Home and Schedule.</p>
    </BottomSheet>
  );
}

function AccountSheet() {
  const m = useMockup();
  return (
    <BottomSheet title="Account">
      <div className={s.accountHead}>
        <span className={s.avatarBig}>A</span>
        <div>
          <strong>Alex</strong>
          <span className={s.muted}>Synced · just now</span>
        </div>
      </div>
      <div className={s.optionList}>
        <button type="button" className={s.option} onClick={() => m.showToast("Synced")}>
          <span aria-hidden>↻</span>
          <strong>Sync now</strong>
        </button>
        <button type="button" className={s.option} onClick={() => m.showToast("Feedback form opens here")}>
          <span aria-hidden>✉️</span>
          <strong>Send feedback</strong>
        </button>
        <button type="button" className={`${s.option} ${s.danger}`} onClick={() => m.showToast("Signing out is turned off in the mockup")}>
          <span aria-hidden>⎋</span>
          <strong>Sign out</strong>
        </button>
      </div>
    </BottomSheet>
  );
}

/* ---------- Tasks ---------- */

/** The same task form as the desktop, full screen, closed with one tap. */
function AddSheet({ editId }: { editId?: string }) {
  const m = useMockup();
  const editing = editId ? m.data.tasks.find((t) => t.id === editId) : undefined;
  const [draft, setDraft] = useState<Draft>(() => ({
    title: editing?.title ?? "",
    mode: editing?.mode ?? (m.mode === "general" ? "work" : m.mode),
    priority: editing?.priority ?? 3,
    guess: editing?.guess,
    repeat: "none",
  }));
  const [interrupt, setInterrupt] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const ok = draft.title.trim().length > 0;

  const save = () => {
    if (!ok) return;
    if (editId) m.editTask(editId, draft);
    else m.addTask(draft);
    m.closeSheet();
  };

  return (
    <FullScreen
      title={editing ? "Edit task" : "New task"}
      action={
        <button type="button" className={s.fullSave} disabled={!ok} onClick={save}>
          {editing ? "Save" : "Add"}
        </button>
      }
    >
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label>
          Task
          <input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="What needs doing?" autoFocus maxLength={200} enterKeyHint="done" />
        </label>
        <div className={s.field}>
          <span>Mode</span>
          <div className={s.pills}>
            {MODES.filter((x) => x.id !== "general").map((x) => (
              <button key={x.id} type="button" aria-pressed={draft.mode === x.id} onClick={() => set("mode", x.id as MockMode)}>
                {x.icon} {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className={s.field}>
          <span>Priority</span>
          <div className={s.pills}>
            {([1, 2, 3, 4] as const).map((p) => (
              <button key={p} type="button" aria-pressed={draft.priority === p} onClick={() => set("priority", p)}>
                P{p}
              </button>
            ))}
          </div>
        </div>
        <label>
          Your time guess (min)
          <input type="number" inputMode="numeric" min={1} value={draft.guess ?? ""} placeholder="e.g. 30" onChange={(e) => set("guess", e.target.value ? Number(e.target.value) : undefined)} />
        </label>
        <div className={s.two}>
          <label>
            Deadline
            <input type="datetime-local" value={draft.due ?? ""} onChange={(e) => set("due", e.target.value || undefined)} />
          </label>
          <label>
            Planned start
            <input type="datetime-local" value={draft.start ?? ""} onChange={(e) => set("start", e.target.value || undefined)} />
          </label>
        </div>
        <label>
          Repeat
          <select value={draft.repeat} onChange={(e) => set("repeat", e.target.value)}>
            <option value="none">Doesn&apos;t repeat</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Every weekday</option>
            <option value="weekly">Weekly on…</option>
            <option value="monthly">Monthly, same date</option>
          </select>
        </label>
        <label className={s.check}>
          <input type="checkbox" checked={interrupt} onChange={(e) => setInterrupt(e.target.checked)} />
          This is an interrupt
        </label>
      </form>
    </FullScreen>
  );
}

function TaskSheet({ id }: { id: string }) {
  const m = useMockup();
  const t = m.data.tasks.find((x) => x.id === id);
  if (!t) return null;
  const queue = m.data.tasks.filter((x) => x.state === "ready" && m.inMode(x));
  const pos = queue.findIndex((x) => x.id === id);
  const then = (fn: () => void) => () => {
    fn();
    m.closeSheet();
  };

  return (
    <BottomSheet title={t.title}>
      <TaskMeta task={t} />
      {t.blockedBy && <p className={s.muted}>Waiting on {t.blockedBy}</p>}
      <div className={s.actionGrid}>
        {t.state === "running" ? (
          <ActionButton icon="❚❚" label="Pause" onClick={then(() => m.pause(id))} />
        ) : t.state === "ready" ? (
          <ActionButton icon="▶" label="Start" onClick={() => m.start(id) && m.closeSheet()} />
        ) : t.state === "blocked" ? (
          <ActionButton
            icon="✓"
            label="Unblock"
            // Unblocking by hand also sorts the notice about it.
            onClick={then(() => m.sortNotice(NOTICE_FOR[id] ?? "", "Unblocked", (d) => m.patchTask(d, id, { state: "ready", blockedBy: undefined })))}
          />
        ) : null}
        {t.state !== "done" && (
          <ActionButton
            icon="✓"
            label="Done"
            tone="green"
            onClick={() => {
              // The time check replaces this sheet when it opens.
              if (!m.done(id)) m.closeSheet();
            }}
          />
        )}
        {t.state === "ready" && (
          <>
            <ActionButton icon="↑" label="Move up" disabled={pos <= 0} onClick={() => m.move(id, -1)} />
            <ActionButton icon="↓" label="Move down" disabled={pos === queue.length - 1} onClick={() => m.move(id, 1)} />
          </>
        )}
        {t.state !== "blocked" && t.state !== "done" && <ActionButton icon="⏸" label="Block" onClick={() => m.openSheet({ kind: "block", id })} />}
        <ActionButton icon="✎" label="Edit" onClick={() => m.openSheet({ kind: "add", editId: id })} />
      </div>
      <div className={s.field}>
        <span>Priority</span>
        <div className={s.pills}>
          {([1, 2, 3, 4] as const).map((p) => (
            <button key={p} type="button" aria-pressed={t.priority === p} onClick={() => m.setPriority(id, p)}>
              P{p}
            </button>
          ))}
        </div>
        <span className={s.muted}>{PRIORITY[t.priority]}</span>
      </div>
      <button type="button" className={s.deleteRow} onClick={then(() => m.remove(id))}>
        Delete task
      </button>
    </BottomSheet>
  );
}

/** Which notice a blocked task belongs to. */
const NOTICE_FOR: Record<string, string> = { expense: "waiting", plan: "deadlock", budget: "deadlock" };

function ActionButton({ icon, label, onClick, disabled, tone }: { icon: string; label: string; onClick: () => void; disabled?: boolean; tone?: "green" }) {
  return (
    <button type="button" className={`${s.action} ${tone === "green" ? s.actionGreen : ""}`} onClick={onClick} disabled={disabled}>
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}

function BlockSheet({ id }: { id: string }) {
  const m = useMockup();
  const t = m.data.tasks.find((x) => x.id === id);
  const others = m.data.tasks.filter((x) => x.id !== id && x.state !== "done").slice(0, 4);
  if (!t) return null;
  const pick = (label: string) => {
    m.block(id, label);
    m.closeSheet();
  };
  return (
    <BottomSheet title="Waiting on…">
      <p className={s.muted}>{t.title}</p>
      <div className={s.optionList}>
        <button type="button" className={s.option} onClick={() => pick("A person")}>
          <span aria-hidden>👤</span>
          <strong>A person</strong>
        </button>
        <button type="button" className={s.option} onClick={() => pick("An event")}>
          <span aria-hidden>📅</span>
          <strong>An event</strong>
        </button>
        {others.map((o) => (
          <button key={o.id} type="button" className={s.option} onClick={() => pick(o.title)}>
            <span aria-hidden>↳</span>
            <strong>{o.title}</strong>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

/* ---------- Logging ---------- */

const EARLIER = [
  { label: "Now", suffix: "" },
  { label: "30 min ago", suffix: " (30 min ago)" },
  { label: "1 h ago", suffix: " (1 h ago)" },
  { label: "2 h ago", suffix: " (2 h ago)" },
];

/** A ring's quick items, or (from the 💊 button) medicines plus everything. */
function LogSheet({ resource }: { resource?: ResourceId }) {
  const m = useMockup();
  const [when, setWhen] = useState(0);
  const items = resource
    ? LOG_ITEMS[resource]
    : Object.values(LOG_ITEMS)
        .flat()
        .filter((x, k, all) => all.findIndex((y) => y.name === x.name) === k);
  const title = resource ? `Log for ${RESOURCES.find((r) => r.id === resource)!.label}` : "Log";

  return (
    <BottomSheet title={title}>
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
      {!resource && (
        <div className={s.medList}>
          {m.data.meds.map((med) => (
            <div key={med.id} className={s.medRow}>
              <span>
                <strong>💊 {med.name}</strong>
                <span className={s.muted}>
                  {med.when}
                  {med.due ? " · due now" : ""}
                </span>
              </span>
              <button
                type="button"
                className={med.due ? s.btnPrimary : s.btnSoft}
                onClick={() => {
                  m.takeMed(med.id, EARLIER[when].suffix);
                  m.closeSheet();
                }}
              >
                Taken
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={s.logGrid}>
        {items.map((it) => (
          <button
            key={it.name}
            type="button"
            className={s.logItem}
            onClick={() => {
              m.log(it.name, it.adds, EARLIER[when].suffix);
              m.closeSheet();
            }}
          >
            <span aria-hidden>{it.icon}</span>
            {it.name}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

function EarlierSheet({ medId }: { medId: string }) {
  const m = useMockup();
  const med = m.data.meds.find((x) => x.id === medId)!;
  return (
    <BottomSheet title={`When did you take ${med.name}?`}>
      <div className={s.optionList}>
        {EARLIER.slice(1).map((e) => (
          <button
            key={e.label}
            type="button"
            className={s.option}
            onClick={() => {
              m.takeMed(medId, e.suffix);
              m.closeSheet();
            }}
          >
            <span aria-hidden>🕘</span>
            <strong>{e.label}</strong>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

/* ---------- Notices (from the floating button) ---------- */

function NoticeView({ id }: { id: string }) {
  const m = useMockup();
  const n = m.data.notices.find((x) => x.id === id);
  if (!n) return null;
  const sort = (text: string, fn?: Parameters<typeof m.sortNotice>[2]) => {
    m.sortNotice(id, text, fn);
    m.closeSheet();
  };
  const task = (tid: string) => m.data.tasks.find((t) => t.id === tid);

  return (
    <FullScreen title={n.name}>
      {n.kind === "deadlock" && (
        <>
          <p className={s.lead}>These two tasks are each waiting on the other, so neither can start. Pick the one to unblock.</p>
          {["plan", "budget"].map((tid) => {
            const t = task(tid);
            if (!t) return null;
            return (
              <div key={tid} className={s.noticeCard}>
                <strong>{t.title}</strong>
                <span className={s.muted}>Waiting on {t.blockedBy}</span>
                <button
                  type="button"
                  className={s.btnPrimary}
                  onClick={() => sort(`Unblocked: ${t.title}`, (d) => m.patchTask(d, tid, { state: "ready", blockedBy: undefined }))}
                >
                  Unblock this one
                </button>
              </div>
            );
          })}
        </>
      )}

      {n.kind === "waiting" && (
        <>
          <p className={s.lead}>
            <strong>Follow up on expense claim</strong> has been waiting on a reply from finance for 15 days.
          </p>
          <div className={s.stack}>
            <button
              type="button"
              className={`${s.bigButton} ${s.btnPrimary}`}
              onClick={() => sort("Unblocked: back in the queue", (d) => m.patchTask(d, "expense", { state: "ready", blockedBy: undefined }))}
            >
              They replied: unblock it
            </button>
            <div className={s.field}>
              <span>Remind me in</span>
              <div className={s.pills}>
                {["1 day", "3 days", "1 week"].map((d) => (
                  <button key={d} type="button" onClick={() => sort(`OK. MiOS will remind you in ${d}`)}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {n.kind === "checkin" && <CheckIn onDone={(added) => sort(added ? `Added ${added} ${added === 1 ? "task" : "tasks"}` : "Calendar sorted", (d) => d)} />}

      {n.kind === "reward" && (
        <>
          <div className={s.wrapCard}>
            <span className={s.wrapKicker}>This week</span>
            <strong className={s.wrapBig}>12 tasks done</strong>
            <ul>
              <li>
                <b>83%</b> on time
              </li>
              <li>
                <b>Tue</b> was your best day
              </li>
              <li>
                Time guesses <b>18%</b> off, closer than last week
              </li>
            </ul>
          </div>
          <button type="button" className={`${s.bigButton} ${s.btnPrimary}`} onClick={() => sort("Saved to Progress and stats")}>
            Nice
          </button>
        </>
      )}
    </FullScreen>
  );
}

function CheckIn({ onDone }: { onDone: (added: number) => void }) {
  const [choice, setChoice] = useState<Record<string, "task" | "busy" | "skip">>({ c1: "busy", c2: "task", c3: "busy" });
  return (
    <>
      <p className={s.lead}>Today&apos;s calendar has 3 new items. Should each be a task or just busy time?</p>
      {CHECKIN_ITEMS.map((c) => (
        <div key={c.id} className={s.noticeCard}>
          <strong>{c.title}</strong>
          <span className={s.muted}>{c.time}</span>
          <div className={s.pills}>
            {(["task", "busy", "skip"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={choice[c.id] === v} onClick={() => setChoice((x) => ({ ...x, [c.id]: v }))}>
                {v === "task" ? "Task" : v === "busy" ? "Busy" : "Skip"}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className={`${s.bigButton} ${s.btnPrimary}`} onClick={() => onDone(Object.values(choice).filter((v) => v === "task").length)}>
        Done
      </button>
    </>
  );
}

/* ---------- Me: sub-pages ---------- */

const PAGE_TITLE: Record<SubPage, string> = {
  history: "History",
  progress: "Progress and stats",
  meds: "Medicines",
  settings: "Settings",
};

function SubPageView({ page }: { page: SubPage }) {
  const m = useMockup();
  return (
    <FullScreen title={PAGE_TITLE[page]}>
      {page === "history" && (
        <ul className={s.taskList}>
          {m.data.tasks
            .filter((t) => t.state === "done")
            .map((t) => (
              <li key={t.id} className={s.historyRow}>
                <span className={s.taskText}>
                  <strong>{t.title}</strong>
                  <span>
                    {t.guess ? `Guessed ${fmtLength(t.guess)} · ` : ""}took {fmtLength(t.spent)}
                  </span>
                </span>
                <button type="button" className={s.btnSoft} onClick={() => m.openSheet({ kind: "fixtime", id: t.id, from: "history" })}>
                  Fix time
                </button>
              </li>
            ))}
        </ul>
      )}

      {page === "progress" && (
        <>
          <div className={s.noticeCard}>
            <strong>🌱 Child stage</strong>
            <span className={s.muted}>AI helps the most here. 3 of 5 signals for the next stage are met.</span>
            <div className={s.bar}>
              <span style={{ width: "60%" }} />
            </div>
          </div>
          <div className={s.statGrid}>
            <div>
              <b>83%</b>
              <span>on time</span>
            </div>
            <div>
              <b>18%</b>
              <span>guess error</span>
            </div>
            <div>
              <b>4 days</b>
              <span>streak</span>
            </div>
          </div>
          <h3 className={s.sectionTitle}>Stats cards</h3>
          <div className={s.wrapScroller}>
            {["This week", "October", "Your first month"].map((w) => (
              <div key={w} className={s.wrapCard}>
                <span className={s.wrapKicker}>{w}</span>
                <strong className={s.wrapBig}>{w === "This week" ? "12 done" : w === "October" ? "47 done" : "Day 30"}</strong>
              </div>
            ))}
          </div>
        </>
      )}

      {page === "meds" && (
        <div className={s.medList}>
          {m.data.meds.map((med) => (
            <div key={med.id} className={s.medRow}>
              <span>
                <strong>💊 {med.name}</strong>
                <span className={s.muted}>Every day · {med.when}</span>
              </span>
              <button type="button" className={s.btnSoft} onClick={() => m.showToast(`${med.name} paused (mockup)`)}>
                Pause
              </button>
            </div>
          ))}
          <button type="button" className={`${s.bigButton} ${s.btnSoft}`} onClick={() => m.showToast("Adding a medicine opens a form here")}>
            + Add a medicine
          </button>
        </div>
      )}

      {page === "settings" && (
        <ul className={`${s.taskList} ${s.settings}`}>
          <li>
            <span>Tasks running at once</span>
            <div className={s.pills}>
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" aria-pressed={n === 1}>
                  {n}
                </button>
              ))}
            </div>
          </li>
          <li>
            <span>Protected time</span>
            <span className={s.muted}>Sleep 11 PM–7 AM · Gym 6:30–7:30 PM</span>
          </li>
          <li>
            <span>Default time guess</span>
            <span className={s.muted}>30 min</span>
          </li>
          <li>
            <span>Medicine day starts</span>
            <span className={s.muted}>4 AM</span>
          </li>
          <li>
            <span>Backups and calendars</span>
            <span className={s.muted}>On the computer</span>
          </li>
        </ul>
      )}
    </FullScreen>
  );
}

/* ---------- Time it took ---------- */

/** "Forgot to click finish?" after Done, or Fix time from History. */
function TimeSheet({ sheet }: { sheet: Extract<Sheet, { kind: "timecheck" | "fixtime" }> }) {
  const m = useMockup();
  const t = m.data.tasks.find((x) => x.id === sheet.id) as MockTask | undefined;
  const spent = Math.round(t?.spent ?? 0);
  const [hours, setHours] = useState(String(Math.floor(spent / 60)));
  const [mins, setMins] = useState(String(spent % 60));
  if (!t) return null;
  const total = (Number(hours) || 0) * 60 + (Number(mins) || 0);
  const back = () => (sheet.kind === "fixtime" ? m.openSheet({ kind: "page", page: sheet.from }) : m.closeSheet());

  return (
    <BottomSheet title={sheet.kind === "timecheck" ? "Did you forget to click finish?" : `Time it took`}>
      <p className={s.lead}>
        <strong>{t.title}</strong> was Running for {fmtLength(spent)}
        {t.guess ? `, and you guessed ${fmtLength(t.guess)}` : ""}. If it was left running, put in how long it really took.
      </p>
      <div className={s.timeFields}>
        <label>
          <input type="number" inputMode="numeric" min={0} value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours" /> h
        </label>
        <label>
          <input type="number" inputMode="numeric" min={0} max={59} value={mins} onChange={(e) => setMins(e.target.value)} aria-label="Minutes" /> min
        </label>
      </div>
      <p className={s.footNote}>On time or late stays as it was when you clicked finish.</p>
      <div className={s.nowActions}>
        <button type="button" className={`${s.bigButton} ${s.btnSoft}`} onClick={back}>
          {sheet.kind === "timecheck" ? "Skip" : "Cancel"}
        </button>
        <button
          type="button"
          className={`${s.bigButton} ${s.btnPrimary}`}
          disabled={total < 1}
          onClick={() => {
            m.fixTime(t.id, total);
            back();
          }}
        >
          Save
        </button>
      </div>
    </BottomSheet>
  );
}
