"use client";

import { useRef, useState, type PointerEvent } from "react";
import { fmtLength, modeOf, RESOURCES, type MockTask } from "./mockData";
import { useMockup, type Filter } from "./store";
import s from "./mockup.module.css";

const clock = (minutes: number) => {
  const total = Math.floor(minutes * 60);
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export function MainPage() {
  const m = useMockup();
  const tasks = m.data.tasks.filter(m.inMode);
  const running = tasks.find((t) => t.state === "running");
  const next = tasks.find((t) => t.state === "ready");
  const count = (state: Filter) => tasks.filter((t) => t.state === state).length;
  const dueMeds = m.data.meds.filter((x) => x.due);

  return (
    <>
      <div className={s.page}>
        <p className={s.dateLine}>
          Wed, Nov 25 · 10:15 AM · {modeOf(m.mode).label}
        </p>

        {dueMeds.map((med) => (
          <section key={med.id} className={s.medCard} aria-label="Medicine due">
            <div className={s.medText}>
              <span className={s.medIcon} aria-hidden>
                💊
              </span>
              <div>
                <strong>{med.name}</strong>
                <span>{med.when} · due now</span>
              </div>
            </div>
            <div className={s.medActions}>
              <button type="button" className={s.btnPrimary} onClick={() => m.takeMed(med.id)}>
                Taken
              </button>
              <button type="button" className={s.btnSoft} onClick={() => m.openSheet({ kind: "earlier", medId: med.id })}>
                Earlier
              </button>
              <button type="button" className={s.btnPlain} onClick={() => m.dismissMed(med.id)}>
                Dismiss
              </button>
            </div>
          </section>
        ))}

        {running ? (
          <RunningCard task={running} />
        ) : next ? (
          <section className={s.nowCard}>
            <span className={`${s.nowLabel} ${s.nowLabelNext}`}>Up next</span>
            <h2 className={s.nowTitle}>{next.title}</h2>
            <TaskMeta task={next} />
            <button type="button" className={`${s.bigButton} ${s.btnPrimary}`} onClick={() => m.start(next.id)}>
              ▶ Start
            </button>
          </section>
        ) : (
          <section className={`${s.nowCard} ${s.nowEmpty}`}>
            <h2 className={s.nowTitle}>Nothing queued</h2>
            <p className={s.muted}>Add something, or enjoy the free time.</p>
            <button
              type="button"
              className={`${s.bigButton} ${s.btnPrimary}`}
              onClick={() => {
                m.setTab("schedule");
                m.openSheet({ kind: "add" });
              }}
            >
              + Add a task
            </button>
          </section>
        )}

        <div className={s.counts}>
          {(["running", "ready", "blocked"] as const).map((state) => (
            <button
              key={state}
              type="button"
              className={s.countTile}
              onClick={() => {
                m.setFilter(state);
                m.setTab("schedule");
              }}
            >
              <strong className={s[`count_${state}`]}>{count(state)}</strong>
              <span>
                {state === "running" ? "Running / 1" : state === "ready" ? "Ready" : "Blocked"}
              </span>
            </button>
          ))}
        </div>

        <h3 className={s.sectionTitle}>Resources · tap to log</h3>
        <div className={s.rings}>
          {RESOURCES.map((r) => (
            <Ring key={r.id} label={r.label} color={r.color} value={m.data.levels[r.id]} onClick={() => m.openSheet({ kind: "log", resource: r.id })} />
          ))}
        </div>
      </div>

      <Floater />
    </>
  );
}

function RunningCard({ task }: { task: MockTask }) {
  const m = useMockup();
  const spent = m.spentNow(task);
  const over = task.guess ? spent > task.guess : false;
  return (
    <section className={s.nowCard}>
      <span className={s.nowLabel}>
        <span className={s.pulse} aria-hidden /> Running
      </span>
      <h2 className={s.nowTitle}>{task.title}</h2>
      <TaskMeta task={task} />
      <div className={s.timer} aria-label="Time spent">
        {clock(spent)}
      </div>
      {task.guess && (
        <p className={`${s.guess} ${over ? s.over : ""}`}>
          Your guess {fmtLength(task.guess)}
          {over && " · past your guess"}
        </p>
      )}
      <div className={s.nowActions}>
        <button type="button" className={`${s.bigButton} ${s.btnSoft}`} onClick={() => m.pause(task.id)}>
          ❚❚ Pause
        </button>
        <button type="button" className={`${s.bigButton} ${s.btnGreen}`} onClick={() => m.done(task.id)}>
          ✓ Done
        </button>
      </div>
    </section>
  );
}

export function TaskMeta({ task }: { task: MockTask }) {
  const mode = modeOf(task.mode);
  return (
    <p className={s.taskMeta}>
      {mode.icon} {mode.label} · P{task.priority}
      {task.due ? ` · Due ${task.due}` : ""}
    </p>
  );
}

function Ring({ label, color, value, onClick }: { label: string; color: string; value: number; onClick: () => void }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <button type="button" className={s.ring} onClick={onClick} aria-label={`${label} ${value}%. Log something`}>
      <svg viewBox="0 0 76 76" width="76" height="76" aria-hidden>
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--fill)" strokeWidth="8" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`}
          transform="rotate(-90 38 38)"
          className={s.ringArc}
        />
        <text x="38" y="43" textAnchor="middle" className={s.ringValue}>
          {value}%
        </text>
      </svg>
      <span>{label}</span>
    </button>
  );
}

/** Hold this long before the floating button can be dragged. */
const HOLD_MS = 280;

interface Gesture {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  maxX: number;
  maxY: number;
  mode: "press" | "drag" | "swipe" | "none";
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One floating button for everything else that needs you. Tap to open the
 * notice it shows, swipe sideways for the next one, hold and drag to move it
 * anywhere on the page. Sorted notices leave it; with none left it's gone.
 */
function Floater() {
  const m = useMockup();
  const notices = m.data.notices;
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [swipeDx, setSwipeDx] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  const skipClick = useRef(false);

  if (!notices.length) return null;
  const i = Math.min(index, notices.length - 1);
  const notice = notices[i];
  const step = (dir: 1 | -1) => setIndex((i + dir + notices.length) % notices.length);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const box = (el.offsetParent as HTMLElement).getBoundingClientRect();
    const r = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    gesture.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: r.left - box.left,
      oy: r.top - box.top,
      maxX: box.width - r.width - 8,
      maxY: box.height - r.height - 8,
      mode: "press",
      timer: setTimeout(() => {
        if (gesture.current?.mode !== "press") return;
        gesture.current.mode = "drag";
        setDragging(true);
        // A small buzz as it lifts, where the phone allows it.
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(10);
      }, HOLD_MS),
    };
  };

  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (g.mode === "press" && Math.hypot(dx, dy) > 8) {
      clearTimeout(g.timer);
      g.mode = Math.abs(dx) > Math.abs(dy) ? "swipe" : "none";
    }
    if (g.mode === "drag") {
      setPos({ x: Math.min(Math.max(g.ox + dx, 8), g.maxX), y: Math.min(Math.max(g.oy + dy, 8), g.maxY) });
    } else if (g.mode === "swipe") {
      setSwipeDx(dx);
    }
  };

  const up = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    clearTimeout(g.timer);
    const dx = e.clientX - g.sx;
    if (g.mode !== "press") skipClick.current = true;
    if (g.mode === "drag") setDragging(false);
    if (g.mode === "swipe") {
      if (Math.abs(dx) > 36 && notices.length > 1) step(dx < 0 ? 1 : -1);
      setSwipeDx(0);
    }
  };

  return (
    <button
      type="button"
      className={`${s.floater} ${dragging ? s.floaterDragging : ""}`}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      aria-label={`${notices.length} ${notices.length === 1 ? "thing needs" : "things need"} you. Showing ${notice.name}. Swipe for the next, hold to move.`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        if (gesture.current) clearTimeout(gesture.current.timer);
        gesture.current = null;
        setDragging(false);
        setSwipeDx(0);
      }}
      onClick={() => {
        if (skipClick.current) {
          skipClick.current = false;
          return;
        }
        m.openSheet({ kind: "notice", id: notice.id });
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
    >
      <span className={s.floaterDot} aria-hidden />
      <span className={s.floaterLabel} style={swipeDx ? { transform: `translateX(${swipeDx * 0.35}px)`, opacity: 1 - Math.min(Math.abs(swipeDx) / 160, 0.6) } : undefined}>
        <span aria-hidden>{notice.icon}</span>
        <span className={s.floaterName}>{notice.name}</span>
      </span>
      {notices.length > 1 && (
        <span className={s.floaterDots} aria-hidden>
          {notices.map((n, k) => (
            <span key={n.id} className={k === i ? s.on : ""} />
          ))}
        </span>
      )}
    </button>
  );
}
