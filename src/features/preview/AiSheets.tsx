"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fmtHour, fmtLength, type MockTask } from "./mockData";
import { timeline } from "./SchedulePage";
import { useMockup, type AiFeature } from "./store";
import s from "./mockup.module.css";

/**
 * AI on the phone: each feature opens in its own window instead of sitting on
 * the page. Child stage: the AI answers straight away. Teen stage: a quick
 * tap-only question first. Adult stage: no AI. All answers are made up here.
 */

/** The window every AI feature opens in: full screen, or a sheet from the bottom. */
export function AiFrame({ title, onClose, children, full }: { title: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  const close = (
    <button type="button" className={s.close} aria-label="Close" onClick={onClose}>
      ✕
    </button>
  );
  const heading = (
    <h2>
      <span aria-hidden>✨</span> {title}
    </h2>
  );
  if (full) {
    return (
      <div className={s.full} role="dialog" aria-modal aria-label={title}>
        <div className={s.fullHead}>
          {close}
          {heading}
          <span />
        </div>
        <div className={s.fullBody}>{children}</div>
      </div>
    );
  }
  return (
    <div className={s.scrim} onClick={onClose}>
      <div className={s.sheet} role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={s.grabber} aria-hidden />
        <div className={s.sheetHead}>
          {heading}
          {close}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Why({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.why}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Why?
      </button>
      {open && <p>{text}</p>}
    </div>
  );
}

/** A short pause so the answer feels like it came from somewhere. */
function useThinking(active: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setReady(true), 900);
    return () => clearTimeout(id);
  }, [active]);
  return ready;
}

const reasonFor = (t: MockTask): string =>
  t.priority === 1 ? "Most urgent" : t.due ? `Due ${t.due}` : t.guess && t.guess <= 10 ? `Quick, about ${t.guess} min` : `Priority ${t.priority}`;

const suggestedOrder = (tasks: MockTask[]) =>
  [...tasks].sort((a, b) => a.priority - b.priority || Number(!!b.due) - Number(!!a.due) || (a.guess ?? 30) - (b.guess ?? 30));

/* ---------- Suggest an order / Draft my day ---------- */

export function AiWindow({ feature }: { feature: AiFeature }) {
  const m = useMockup();
  const ready = m.data.tasks.filter((t) => t.state === "ready" && m.inMode(t));
  const [asked, setAsked] = useState(m.stage === "child");
  const answered = useThinking(asked);
  const title = feature === "order" ? "Suggest an order" : "Draft my day";

  return (
    <AiFrame title={title} onClose={m.closeSheet} full>
      {!asked ? (
        <ThinkFirst feature={feature} tasks={ready} onDone={() => setAsked(true)} />
      ) : !answered ? (
        <p className={s.thinking}>Thinking…</p>
      ) : feature === "order" ? (
        <OrderAnswer tasks={ready} />
      ) : (
        <DraftAnswer tasks={ready} />
      )}
    </AiFrame>
  );
}

function OrderAnswer({ tasks }: { tasks: MockTask[] }) {
  const m = useMockup();
  const order = suggestedOrder(tasks);
  return (
    <>
      <p className={s.lead}>A suggested order for your queue. Nothing changes unless you use it.</p>
      <ol className={s.aiList}>
        {order.map((t, k) => (
          <li key={t.id}>
            <span className={s.taskNum}>{k + 1}</span>
            <span className={s.taskText}>
              <strong>{t.title}</strong>
              <span>{reasonFor(t)}</span>
            </span>
          </li>
        ))}
      </ol>
      <Why text="Urgent first, then anything with a deadline, then quick tasks so they don't pile up. You know things the AI doesn't, so keeping your own order is fine." />
      <div className={s.nowActions}>
        <button
          type="button"
          className={`${s.bigButton} ${s.btnSoft}`}
          onClick={() => {
            m.showToast("Kept your order");
            m.closeSheet();
          }}
        >
          Keep mine
        </button>
        <button
          type="button"
          className={`${s.bigButton} ${s.btnPrimary}`}
          onClick={() => {
            m.applyOrder(
              order.map((t) => t.id),
              "Queue reordered",
            );
            m.closeSheet();
          }}
        >
          Use this order
        </button>
      </div>
    </>
  );
}

function DraftAnswer({ tasks }: { tasks: MockTask[] }) {
  const m = useMockup();
  // Fit each task, in the suggested order, into the first free gap long enough for it.
  const gaps = timeline(m.data.tasks.filter((t) => t.state !== "ready" || t.start === undefined))
    .filter((x) => x.kind === "free")
    .map((x) => ({ from: x.from, to: x.to }));
  const placed: { task: MockTask; start: number }[] = [];
  const left: MockTask[] = [];
  for (const t of suggestedOrder(tasks)) {
    const hours = (t.guess ?? 30) / 60;
    const gap = gaps.find((g) => g.to - g.from >= hours);
    if (!gap) {
      left.push(t);
      continue;
    }
    placed.push({ task: t, start: gap.from });
    gap.from += hours;
  }
  placed.sort((a, b) => a.start - b.start);

  return (
    <>
      <p className={s.lead}>A plan for the rest of today, in your free time only. Using it sets these start times and puts your queue in this order.</p>
      <ol className={s.aiList}>
        {placed.map(({ task, start }) => (
          <li key={task.id}>
            <span className={s.aiTime}>{fmtHour(start)}</span>
            <span className={s.taskText}>
              <strong>{task.title}</strong>
              <span>{fmtLength(task.guess ?? 30)}</span>
            </span>
          </li>
        ))}
      </ol>
      {left.length > 0 && <p className={s.muted}>Doesn&apos;t fit today: {left.map((t) => t.title).join(", ")}.</p>}
      <Why text="Short tasks go in the small gaps, so the long ones get the bigger blocks of free time. Calendar items and protected time are left alone." />
      <div className={s.nowActions}>
        <button
          type="button"
          className={`${s.bigButton} ${s.btnSoft}`}
          onClick={() => {
            m.showToast("Kept your plan");
            m.closeSheet();
          }}
        >
          Keep mine
        </button>
        <button
          type="button"
          className={`${s.bigButton} ${s.btnPrimary}`}
          disabled={!placed.length}
          onClick={() => {
            m.applySchedule(placed.map((p) => ({ id: p.task.id, start: p.start })));
            m.closeSheet();
          }}
        >
          Use this plan
        </button>
      </div>
    </>
  );
}

/** Teen stage: think first, by tapping only. Never graded; skipping is fine. */
function ThinkFirst({ feature, tasks, onDone }: { feature: AiFeature; tasks: MockTask[]; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const few = tasks.slice(0, 4);

  if (feature === "order") {
    return (
      <>
        <p className={s.askKicker}>Think first</p>
        <p className={s.askQuestion}>Which of these would you do first?</p>
        <div className={s.optionList}>
          {few.map((t) => (
            <button key={t.id} type="button" className={s.option} onClick={onDone}>
              <strong>{t.title}</strong>
            </button>
          ))}
        </div>
        <button type="button" className={s.btnPlain} onClick={onDone}>
          Skip
        </button>
      </>
    );
  }

  const tap = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <>
      <p className={s.askKicker}>Think first</p>
      <p className={s.askQuestion}>Tap these in the order you&apos;d do them today.</p>
      <div className={s.optionList}>
        {few.map((t) => {
          const n = picked.indexOf(t.id);
          return (
            <button key={t.id} type="button" className={s.option} aria-pressed={n >= 0} onClick={() => tap(t.id)}>
              <span className={s.taskNum}>{n >= 0 ? n + 1 : "·"}</span>
              <strong>{t.title}</strong>
            </button>
          );
        })}
      </div>
      <div className={s.nowActions}>
        <button type="button" className={`${s.bigButton} ${s.btnSoft}`} onClick={onDone}>
          Skip
        </button>
        <button type="button" className={`${s.bigButton} ${s.btnPrimary}`} disabled={picked.length < few.length} onClick={onDone}>
          See the AI&apos;s plan
        </button>
      </div>
    </>
  );
}

/* ---------- Time estimate on Start ---------- */

const GUESSES = [5, 10, 15, 30, 45, 60, 90];

export function EstimateSheet({ id }: { id: string }) {
  const m = useMockup();
  const t = m.data.tasks.find((x) => x.id === id);
  const [mine, setMine] = useState<number | null>(null);
  if (!t) return null;
  const ai = t.id === "alex" ? 10 : 20;
  // Child stage sees the AI's guess up front; teen stage after making their own.
  const showAi = m.aiOn && (m.stage === "child" || mine !== null);
  const go = (minutes: number) => {
    m.start(id, minutes);
    m.closeSheet();
  };

  return (
    <AiFrame title="How long will it take?" onClose={m.closeSheet}>
      <p className={s.muted}>{t.title}</p>
      {showAi && (
        <div className={s.aiCard}>
          <span>
            AI guess: <strong>{fmtLength(ai)}</strong>
          </span>
          <button type="button" className={s.btnSoft} onClick={() => go(ai)}>
            Use it
          </button>
        </div>
      )}
      {showAi && <Why text="Tasks like this took you 8 to 25 minutes before, and your guesses tend to run a little short." />}
      <div className={s.field}>
        <span>{m.aiOn && m.stage === "teen" && mine === null ? "Your guess first" : "Your guess"}</span>
        <div className={s.pills}>
          {GUESSES.map((g) => (
            <button key={g} type="button" aria-pressed={mine === g} onClick={() => setMine(g)}>
              {fmtLength(g)}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className={`${s.bigButton} ${s.btnPrimary}`} disabled={mine === null} onClick={() => mine && go(mine)}>
        ▶ Start{mine ? ` with ${fmtLength(mine)}` : ""}
      </button>
    </AiFrame>
  );
}

/* ---------- Interrupt check ---------- */

export function InterruptSheet({ id }: { id: string }) {
  const m = useMockup();
  const t = m.data.tasks.find((x) => x.id === id);
  if (!t) return null;
  const next = m.data.tasks.find((x) => x.state === "ready" && x.id !== id);
  const push = t.guess ?? 30;
  const decide = (first: boolean) => {
    m.decideInterrupt(id, first);
    m.closeSheet();
  };
  return (
    <AiFrame title="Interrupt check" onClose={m.closeSheet}>
      <p className={s.lead}>
        <strong>{t.title}</strong> came up. Do it first, or put it in the queue?
      </p>
      {next && (
        <p className={s.muted}>
          Doing it first moves <strong>{next.title}</strong> back by about {fmtLength(push)}.
        </p>
      )}
      {m.aiOn && (
        <>
          <div className={s.aiCard}>
            <span>Doing it first would push the report into your 3 PM class. Queue it unless it can&apos;t wait.</span>
          </div>
          <Why text="Your 1:30 PM report needs 1 h 30 min, and the class starts at 3 PM. Any delay over 0 min makes them overlap." />
        </>
      )}
      <div className={s.nowActions}>
        <button type="button" className={`${s.bigButton} ${s.btnSoft}`} onClick={() => decide(false)}>
          Queue it
        </button>
        <button type="button" className={`${s.bigButton} ${s.btnPrimary}`} onClick={() => decide(true)}>
          Do it first
        </button>
      </div>
    </AiFrame>
  );
}

/* ---------- Look back after a big task ---------- */

const QUESTIONS = ["What took longer than you expected, and why?", "What would you do differently next time?", "What helped you keep going?"];

export function ReviewSheet({ id }: { id: string }) {
  const m = useMockup();
  const t = m.data.tasks.find((x) => x.id === id);
  const [answers, setAnswers] = useState<string[]>([]);
  if (!t) return null;
  const close = (saved: boolean) => {
    m.showToast(saved && answers.some((a) => a.trim()) ? "Saved to History" : "Skipped");
    m.closeSheet();
  };
  return (
    <AiFrame title={`Look back: ${t.title}`} onClose={() => close(false)} full>
      <p className={s.lead}>A big one is done. A few questions about how it went. No grades; answer any you like, or skip.</p>
      {QUESTIONS.map((q, k) => (
        <label key={q} className={s.reviewQ}>
          {q}
          <textarea rows={2} value={answers[k] ?? ""} onChange={(e) => setAnswers((a) => Object.assign([...a], { [k]: e.target.value }))} />
        </label>
      ))}
      {m.aiOn && <Why text="These come from how the task went: you guessed 1 h and it ran a little over, with the deadline tomorrow." />}
      <div className={s.nowActions}>
        <button type="button" className={`${s.bigButton} ${s.btnSoft}`} onClick={() => close(false)}>
          Skip
        </button>
        <button type="button" className={`${s.bigButton} ${s.btnPrimary}`} onClick={() => close(true)}>
          Save
        </button>
      </div>
    </AiFrame>
  );
}
