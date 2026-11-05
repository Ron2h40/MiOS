"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { minutesBetween, readyQueue } from "@/core";
import { useHydrated, useNow } from "@/state/hooks";
import { useMios } from "@/state/store";
import { formatMinutes } from "@/ui/format";
import { Button } from "@/ui/primitives";
import { Toaster, useToast } from "@/ui/toast";
import s from "./focus.module.css";

const clock = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = Math.floor(totalSeconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** A7 — the illusionist: one task on screen, everything else hidden. */
export function FocusView() {
  const hydrated = useHydrated();
  const params = useSearchParams();
  const router = useRouter();
  const now = useNow(1000);
  const tasks = useMios((st) => st.tasks);
  const setTaskState = useMios((st) => st.setTaskState);
  const toast = useToast((st) => st.show);

  if (!hydrated) return <div className={s.screen} />;

  const running = tasks.filter((t) => t.state === "running");
  const task = running.find((t) => t.id === params.get("task")) ?? running[0];
  const next = readyQueue(tasks)[0];

  const act = (id: string, to: "ready" | "done" | "running") => {
    const r = setTaskState(id, to);
    if (!r.ok) toast(r.error, "warn");
    else if (to !== "running") router.push("/m/general");
  };

  const elapsedMin = task ? task.actualMinutes + (task.runningSince ? minutesBetween(task.runningSince, now) : 0) : 0;
  const over = task?.estimateMinutes ? elapsedMin > task.estimateMinutes : false;

  return (
    <div className={s.screen}>
      <div className={s.top}>
        <span>Focus</span>
        <Link href="/m/general">Exit</Link>
      </div>

      <div className={s.center}>
        {task ? (
          <>
            <span className={s.label}>Running</span>
            <h1 className={s.title}>{task.title}</h1>
            <div className={s.timer} aria-label="Time spent">
              {clock(elapsedMin * 60)}
            </div>
            {task.estimateMinutes && (
              <p className={`${s.guess} ${over ? s.over : ""}`}>
                Your guess: {formatMinutes(task.estimateMinutes)}
                {over && " · past your guess"}
              </p>
            )}
            <div className={s.actions}>
              <Button onClick={() => act(task.id, "ready")}>Pause</Button>
              <Button variant="primary" onClick={() => act(task.id, "done")}>
                Done
              </Button>
            </div>
          </>
        ) : next ? (
          <>
            <span className={s.label} style={{ color: "var(--accent)" }}>
              Up next
            </span>
            <h1 className={s.title}>{next.title}</h1>
            <Button variant="primary" onClick={() => act(next.id, "running")}>
              Start
            </Button>
          </>
        ) : (
          <>
            <h1 className={s.title}>Nothing to focus on.</h1>
            <Link href="/m/general">Back to your tasks</Link>
          </>
        )}
      </div>

      <p className={s.bottom}>Everything else is hidden until you leave.</p>
      <Toaster />
    </div>
  );
}
