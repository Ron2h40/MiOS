"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  START_LEVELS,
  START_MEDS,
  START_NOTICES,
  START_TASKS,
  type MockMed,
  type MockMode,
  type MockTask,
  type ModeView,
  type Notice,
  type ResourceId,
} from "./mockData";

/** Everything the mockup changes. Undo puts a snapshot of this back. */
interface Data {
  tasks: MockTask[];
  notices: Notice[];
  meds: MockMed[];
  levels: Record<ResourceId, number>;
}

export type Tab = "home" | "schedule" | "me";
export type Stage = "child" | "teen" | "adult";
export type AiFeature = "order" | "schedule";
export type Filter = "all" | "running" | "ready" | "blocked";
export type SubPage = "history" | "progress" | "meds" | "settings";

export type Sheet =
  | { kind: "mode" }
  | { kind: "account" }
  | { kind: "add"; editId?: string; start?: string }
  | { kind: "task"; id: string }
  | { kind: "block"; id: string }
  | { kind: "log"; resource?: ResourceId }
  | { kind: "earlier"; medId: string }
  | { kind: "notice"; id: string }
  | { kind: "page"; page: SubPage }
  | { kind: "timecheck"; id: string }
  | { kind: "fixtime"; id: string; from: SubPage }
  | { kind: "ai"; feature: AiFeature }
  | { kind: "estimate"; id: string }
  | { kind: "interrupt"; id: string }
  | { kind: "review"; id: string }
  | { kind: "stage" };

export interface Draft {
  title: string;
  mode: MockMode;
  priority: 1 | 2 | 3 | 4;
  guess?: number;
  due?: string;
  start?: string;
  repeat: string;
}

interface Toast {
  id: number;
  text: string;
  undo?: Data;
}

const RUNNING_CAP = 1;

/** A big task gets the look-back questions after it's done. */
export const isBig = (t: Pick<MockTask, "guess" | "spent">): boolean => (t.guess ?? 0) >= 60 || t.spent >= 60;

function useMockupState() {
  const [data, setData] = useState<Data>({ tasks: START_TASKS, notices: START_NOTICES, meds: START_MEDS, levels: START_LEVELS });
  const [tab, setTab] = useState<Tab>("home");
  const [mode, setMode] = useState<ModeView>("general");
  const [filter, setFilter] = useState<Filter>("all");
  const [stage, setStage] = useState<Stage>("child");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // Seconds in the current running stretch; added to the task when it stops.
  const [runSeconds, setRunSeconds] = useState(0);
  const sheetOpen = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastId = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setRunSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // The phone's back gesture closes the open window instead of leaving the page.
  useEffect(() => {
    const onPop = () => {
      sheetOpen.current = false;
      setSheet(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openSheet = useCallback((next: Sheet) => {
    if (!sheetOpen.current) {
      sheetOpen.current = true;
      window.history.pushState({ ...window.history.state, mockSheet: true }, "");
    }
    setSheet(next);
  }, []);

  const closeSheet = useCallback(() => {
    if (sheetOpen.current) window.history.back();
  }, []);

  const showToast = useCallback((text: string, undo?: Data) => {
    clearTimeout(toastTimer.current);
    toastId.current += 1;
    setToast({ id: toastId.current, text, undo });
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const undo = () => {
    if (toast?.undo) setData(toast.undo);
    setToast(null);
  };

  /** Change the data and offer Undo. */
  const change = (text: string, fn: (d: Data) => Data) => {
    const before = data;
    setData(fn(data));
    showToast(text, before);
  };

  const patchTask = (d: Data, id: string, patch: Partial<MockTask>): Data => ({
    ...d,
    tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  });

  const running = data.tasks.filter((t) => t.state === "running");
  const spentNow = (t: MockTask) => t.spent + (t.state === "running" ? runSeconds / 60 : 0);

  /**
   * Start a task. Without a time guess it asks for one first (with the AI's
   * estimate at child and teen stage); `guess` is that answer.
   */
  const start = (id: string, guess?: number) => {
    if (running.length >= RUNNING_CAP && !running.some((t) => t.id === id)) {
      showToast(`One task runs at a time. Pause "${running[0].title}" first.`);
      return false;
    }
    const t = data.tasks.find((x) => x.id === id)!;
    if (!t.guess && !guess) {
      openSheet({ kind: "estimate", id });
      return false;
    }
    setRunSeconds(0);
    change("Started", (d) => patchTask(d, id, { state: "running", ...(guess ? { guess } : {}) }));
    return true;
  };

  const pause = (id: string) => {
    const t = data.tasks.find((x) => x.id === id)!;
    change("Paused", (d) => patchTask(d, id, { state: "ready", spent: spentNow(t) }));
  };

  /**
   * Finish a task. A task that took twice its guess asks "forgot to click
   * finish?" first; a big one then gets the look-back questions. True when a
   * window opened.
   */
  const done = (id: string): boolean => {
    const t = data.tasks.find((x) => x.id === id)!;
    const spent = spentNow(t);
    change(`Done: ${t.title}`, (d) => patchTask(d, id, { state: "done", spent }));
    if (t.guess && spent >= t.guess * 2) {
      openSheet({ kind: "timecheck", id });
      return true;
    }
    if (isBig(t)) {
      openSheet({ kind: "review", id });
      return true;
    }
    return false;
  };

  /** Use an AI order: the ready tasks in this order, in the slots they held. */
  const applyOrder = (ids: string[], text: string) =>
    change(text, (d) => {
      const slots = d.tasks.map((t, k) => (ids.includes(t.id) ? k : -1)).filter((k) => k >= 0);
      const tasks = [...d.tasks];
      ids.forEach((id, k) => {
        tasks[slots[k]] = d.tasks.find((t) => t.id === id)!;
      });
      return { ...d, tasks };
    });

  /** Use a drafted day: start times, and the queue in that order. */
  const applySchedule = (starts: { id: string; start: number }[]) => {
    const before = data;
    const ordered = [...starts].sort((a, b) => a.start - b.start).map((x) => x.id);
    const withTimes = starts.reduce((d, x) => patchTask(d, x.id, { start: x.start }), data);
    const slots = withTimes.tasks.map((t, k) => (ordered.includes(t.id) ? k : -1)).filter((k) => k >= 0);
    const tasks = [...withTimes.tasks];
    ordered.forEach((id, k) => {
      tasks[slots[k]] = withTimes.tasks.find((t) => t.id === id)!;
    });
    setData({ ...withTimes, tasks });
    showToast("Day planned. The queue follows it.", before);
  };

  /** An interrupt: run it first, or queue it normally. */
  const decideInterrupt = (id: string, first: boolean) => {
    if (!first) return showToast("Queued like any other task");
    change("Moved to the front of the queue", (d) => {
      const t = d.tasks.find((x) => x.id === id)!;
      return { ...d, tasks: [t, ...d.tasks.filter((x) => x.id !== id)] };
    });
  };

  const setPriority = (id: string, priority: MockTask["priority"]) =>
    change(`Priority set to P${priority}`, (d) => patchTask(d, id, { priority }));

  const move = (id: string, dir: -1 | 1) => {
    const queue = data.tasks.filter((t) => t.state === "ready" && (mode === "general" || t.mode === mode));
    const i = queue.findIndex((t) => t.id === id);
    const other = queue[i + dir];
    if (!other) return;
    change(dir < 0 ? "Moved up" : "Moved down", (d) => {
      const tasks = [...d.tasks];
      const a = tasks.findIndex((t) => t.id === id);
      const b = tasks.findIndex((t) => t.id === other.id);
      [tasks[a], tasks[b]] = [tasks[b], tasks[a]];
      return { ...d, tasks };
    });
  };

  const block = (id: string, label: string) => {
    const t = data.tasks.find((x) => x.id === id)!;
    change(`Blocked: waiting on ${label.toLowerCase()}`, (d) => patchTask(d, id, { state: "blocked", blockedBy: label, spent: spentNow(t) }));
  };

  const remove = (id: string) => change("Deleted", (d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));

  const toTask = (draft: Draft): Pick<MockTask, "title" | "mode" | "priority" | "guess" | "due" | "start"> => {
    // A planned start today shows on the calendar.
    const start = draft.start ? new Date(draft.start) : null;
    return {
      title: draft.title.trim(),
      mode: draft.mode,
      priority: draft.priority,
      guess: draft.guess,
      due: draft.due ? new Date(draft.due).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : undefined,
      start: start && start.getMonth() === 10 && start.getDate() === 25 ? start.getHours() + start.getMinutes() / 60 : undefined,
    };
  };

  /** Add a task; returns its id. */
  const addTask = (draft: Draft): string => {
    const id = `new-${data.tasks.length}-${draft.title.length}`;
    change(`Added: ${draft.title.trim()}`, (d) => ({
      ...d,
      tasks: [...d.tasks, { id, state: "ready", spent: 0, ...toTask(draft) }],
    }));
    return id;
  };

  const editTask = (id: string, draft: Draft) => change("Saved", (d) => patchTask(d, id, toTask(draft)));

  const log = (name: string, adds: Partial<Record<ResourceId, number>>, when = "") =>
    change(`Logged ${name}${when}`, (d) => ({
      ...d,
      levels: Object.fromEntries(
        Object.entries(d.levels).map(([k, v]) => [k, Math.min(100, v + (adds[k as ResourceId] ?? 0))]),
      ) as Data["levels"],
    }));

  const takeMed = (id: string, when = "") => {
    const m = data.meds.find((x) => x.id === id)!;
    change(`Logged ${m.name}${when}`, (d) => ({ ...d, meds: d.meds.map((x) => (x.id === id ? { ...x, due: false } : x)) }));
  };

  const dismissMed = (id: string) =>
    change("Reminder hidden for today", (d) => ({ ...d, meds: d.meds.map((x) => (x.id === id ? { ...x, due: false } : x)) }));

  /** A notice is sorted: it leaves the floating button. */
  const sortNotice = (id: string, text: string, fn: (d: Data) => Data = (d) => d) =>
    change(text, (d) => {
      const next = fn(d);
      return { ...next, notices: next.notices.filter((n) => n.id !== id) };
    });

  const fixTime = (id: string, minutes: number) => change(`Time set to ${Math.round(minutes)} min`, (d) => patchTask(d, id, { spent: minutes }));

  return {
    data,
    tab,
    setTab,
    mode,
    setMode,
    filter,
    setFilter,
    sheet,
    openSheet,
    closeSheet,
    toast,
    undo,
    showToast,
    spentNow,
    inMode: (t: MockTask) => mode === "general" || t.mode === mode,
    stage,
    setStage,
    /** AI helps at child and teen stage; at adult stage it's gone. */
    aiOn: stage !== "adult",
    applyOrder,
    applySchedule,
    decideInterrupt,
    start,
    pause,
    done,
    setPriority,
    move,
    block,
    remove,
    addTask,
    editTask,
    log,
    takeMed,
    dismissMed,
    sortNotice,
    patchTask,
    fixTime,
  };
}

export type Mockup = ReturnType<typeof useMockupState>;

const Ctx = createContext<Mockup | null>(null);

export function MockupProvider({ children }: { children: ReactNode }) {
  const value = useMockupState();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useMockup = (): Mockup => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMockup outside MockupProvider");
  return v;
};
