"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  err,
  evaluateGate,
  finishedOnTime,
  hasActiveBlockers,
  moveInQueue,
  nextOrder,
  ok,
  readyQueue,
  splitByDeadline,
  stageEnteredAt,
  startTask,
  transition,
  type Blocker,
  type ISODateTime,
  type MiosEvent,
  type MiosEventInput,
  type ModeId,
  type Priority,
  type ProcessState,
  type Result,
  type Settings,
  type Stage,
  type Task,
  type TaskModeId,
} from "@/core";

/**
 * App state. This layer wires the pure rules in `src/core` to persistence and
 * the metrics event log. Components call these actions; they never mutate
 * tasks or apply OS rules themselves.
 */

export const STORAGE_KEY = "mios:v1";
const SCHEMA_VERSION = 1;

export interface NewTaskInput {
  title: string;
  mode: TaskModeId;
  priority: Priority;
  deadline?: ISODateTime;
  scheduledStart?: ISODateTime;
  estimateMinutes?: number;
  isInterrupt?: boolean;
  protectedOverride?: boolean;
}

export type TaskPatch = Partial<
  Pick<Task, "title" | "mode" | "priority" | "deadline" | "scheduledStart" | "estimateMinutes" | "protectedOverride">
>;

export type NewBlocker =
  | { kind: "task"; taskId: string }
  | { kind: "person"; label: string }
  | { kind: "event"; label: string };

export const DEFAULT_SETTINGS: Settings = {
  stage: "child",
  runningCap: 1,
  starvationDays: 14,
  defaultEstimateMinutes: 30,
  protectedBlocks: [
    { id: "sleep", label: "Sleep", days: [], start: "23:00", end: "07:00" },
  ],
};

interface Data {
  tasks: Task[];
  events: MiosEvent[];
  settings: Settings;
  /** When this person started using MiOS (fallback for "days at stage"). */
  startedAt: ISODateTime;
}

interface Actions {
  addTask(input: NewTaskInput): Task;
  updateTask(id: string, patch: TaskPatch): void;
  deleteTask(id: string): void;
  setTaskState(id: string, to: ProcessState): Result<Task>;

  addBlocker(taskId: string, blocker: NewBlocker): void;
  removeBlocker(taskId: string, blockerId: string, opts?: { breakingDeadlock?: number }): void;
  resolveBlocker(taskId: string, blockerId: string): void;

  moveTask(id: string, direction: "up" | "down", mode: ModeId): void;
  sortByPriority(mode: ModeId): void;
  /** A3: the user chose to run an interrupt first, or queue it normally. */
  decideInterrupt(id: string, decision: "run_first" | "queue", usedAi?: boolean): void;

  /** B1: the user accepted an AI order (applied) or kept their own. */
  resolveAiOrder(order: string[], outcome: "accepted" | "overridden"): void;
  /** B2: apply a drafted schedule. Edited drafts count as the user's own plan. */
  resolveAiSchedule(starts: { taskId: string; start: ISODateTime }[], outcome: "accepted" | "overridden"): void;
  /** Any AI feature was used (feeds the background log). */
  logAiUse(feature: string): void;
  /** Teen pop-up answered or skipped. Product metric only; never a gate signal. */
  logPopup(feature: string, outcome: "answered" | "skipped"): void;

  setStage(stage: Stage, reason?: "auto" | "manual"): void;
  /** Move the user up a stage if every gate signal passes. Returns the new stage if it changed. */
  checkStageUp(): Stage | null;
  updateSettings(patch: Partial<Settings>): void;

  log(event: MiosEventInput): void;
  importData(json: string): Result<void>;
  loadSample(tasks: Task[]): void;
  reset(): void;
}

export type MiosStore = Data & Actions;

const now = (): ISODateTime => new Date().toISOString();
const uid = (): string => crypto.randomUUID();

const initialData = (): Data => ({
  tasks: [],
  events: [],
  settings: DEFAULT_SETTINGS,
  startedAt: now(),
});

/** Blocked tasks whose blockers have all cleared wake up into Ready, like an OS process. */
const wakeUnblocked = (tasks: Task[], at: ISODateTime): Task[] => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.map((t) => {
    if (t.state !== "blocked" || hasActiveBlockers(t, byId)) return t;
    const r = transition(t, "ready", at);
    return r.ok ? r.value : t;
  });
};

export const useMios = create<MiosStore>()(
  persist(
    (set, get) => {
      const stamp = (e: MiosEventInput): MiosEvent => ({ ...e, at: now(), stage: get().settings.stage }) as MiosEvent;
      const pushEvents = (...events: MiosEventInput[]) =>
        set((s) => ({ events: [...s.events, ...events.map(stamp)] }));

      const replaceTask = (id: string, fn: (t: Task) => Task) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? fn(t) : t)) }));

      /** Reorder tasks. A manual reorder makes the order the user's own again. */
      const applyOrder = (order: Map<string, number>, aiPlanned = false) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            order.has(t.id) ? { ...t, order: order.get(t.id)!, aiPlanned, updatedAt: now() } : t,
          ),
        }));

      const queueFor = (mode: ModeId) =>
        readyQueue(mode === "general" ? get().tasks : get().tasks.filter((t) => t.mode === mode));

      return {
        ...initialData(),

        addTask(input) {
          const at = now();
          const task: Task = {
            id: uid(),
            title: input.title.trim(),
            mode: input.mode,
            state: "ready",
            priority: input.priority,
            order: nextOrder(get().tasks),
            deadline: input.deadline,
            scheduledStart: input.scheduledStart,
            protectedOverride: input.protectedOverride,
            estimateMinutes: input.estimateMinutes,
            isInterrupt: input.isInterrupt ?? false,
            blockedBy: [],
            actualMinutes: 0,
            createdAt: at,
            updatedAt: at,
            stateChangedAt: at,
          };
          set((s) => ({ tasks: [...s.tasks, task] }));
          pushEvents({ type: "task_created", taskId: task.id, mode: task.mode, isInterrupt: task.isInterrupt });
          if (input.protectedOverride) {
            pushEvents({ type: "referee_override", taskId: task.id, blockLabel: "protected time" });
          }
          return task;
        },

        updateTask(id, patch) {
          const before = get().tasks.find((t) => t.id === id);
          replaceTask(id, (t) => ({ ...t, ...patch, updatedAt: now() }));
          if (before && patch.protectedOverride && !before.protectedOverride) {
            pushEvents({ type: "referee_override", taskId: id, blockLabel: "protected time" });
          }
          if (patch.priority !== undefined && patch.priority !== before?.priority) {
            pushEvents({ type: "decision_made", usedAi: false, feature: "priority" });
          }
          if (patch.estimateMinutes && patch.estimateMinutes !== before?.estimateMinutes) {
            pushEvents({ type: "time_guess", taskId: id, minutes: patch.estimateMinutes });
          }
        },

        deleteTask(id) {
          const at = now();
          set((s) => ({
            tasks: wakeUnblocked(
              s.tasks
                .filter((t) => t.id !== id)
                .map((t) => ({ ...t, blockedBy: t.blockedBy.filter((b) => !(b.kind === "task" && b.taskId === id)) })),
              at,
            ),
          }));
        },

        setTaskState(id, to) {
          const { tasks, settings } = get();
          const task = tasks.find((t) => t.id === id);
          if (!task) return err("Task not found.");
          const at = now();
          const r = to === "running" ? startTask(task, tasks, settings, at) : transition(task, to, at);
          if (!r.ok) return r;

          const updated = r.value;
          set((s) => {
            const next = s.tasks.map((t) => (t.id === id ? updated : t));
            // Finishing a task can clear other tasks' blockers.
            return { tasks: to === "done" ? wakeUnblocked(next, at) : next };
          });

          pushEvents({ type: "task_state_changed", taskId: id, from: task.state, to });
          if (to === "done") {
            pushEvents({
              type: "task_completed",
              taskId: id,
              onTime: finishedOnTime(updated),
              // Not their own choice when the order or start time came from an accepted AI suggestion.
              ownChoice: !updated.aiPlanned,
            });
            get().checkStageUp();
          }
          return ok(updated);
        },

        addBlocker(taskId, input) {
          const at = now();
          const blocker: Blocker =
            input.kind === "task"
              ? { id: uid(), kind: "task", taskId: input.taskId }
              : { id: uid(), kind: input.kind, label: input.label.trim(), resolved: false };
          set((s) => {
            const tasks = s.tasks.map((t) => (t.id === taskId ? { ...t, blockedBy: [...t.blockedBy, blocker] } : t));
            const byId = new Map(tasks.map((t) => [t.id, t]));
            return {
              tasks: tasks.map((t) => {
                if (t.id !== taskId || t.state === "blocked" || t.state === "done") return t;
                if (!hasActiveBlockers(t, byId)) return t;
                const r = transition(t, "blocked", at);
                return r.ok ? r.value : t;
              }),
            };
          });
          pushEvents({ type: "blocker_added", taskId, kind: input.kind });
        },

        removeBlocker(taskId, blockerId, opts) {
          set((s) => ({
            tasks: wakeUnblocked(
              s.tasks.map((t) =>
                t.id === taskId ? { ...t, blockedBy: t.blockedBy.filter((b) => b.id !== blockerId) } : t,
              ),
              now(),
            ),
          }));
          if (opts?.breakingDeadlock) {
            pushEvents(
              { type: "deadlock_broken", cycleLength: opts.breakingDeadlock },
              { type: "decision_made", usedAi: false, feature: "deadlock" },
            );
          }
        },

        resolveBlocker(taskId, blockerId) {
          set((s) => ({
            tasks: wakeUnblocked(
              s.tasks.map((t) =>
                t.id === taskId
                  ? {
                      ...t,
                      blockedBy: t.blockedBy.map((b) => (b.id === blockerId && b.kind !== "task" ? { ...b, resolved: true } : b)),
                    }
                  : t,
              ),
              now(),
            ),
          }));
        },

        moveTask(id, direction, mode) {
          // Moves stay inside the task's own section (with or without a deadline).
          const { timed, untimed } = splitByDeadline(queueFor(mode));
          const section = timed.some((t) => t.id === id) ? timed : untimed;
          const order = moveInQueue(section, id, direction);
          if (!order.size) return;
          applyOrder(order);
          pushEvents({ type: "decision_made", usedAi: false, feature: "order" });
        },

        sortByPriority(mode) {
          const sorted = readyQueue(
            mode === "general" ? get().tasks : get().tasks.filter((t) => t.mode === mode),
            "priority-deadline",
          );
          // Keep sorted tasks in the same slots they held in the global order.
          const slots = sorted.map((t) => t.order).sort((a, b) => a - b);
          applyOrder(new Map(sorted.map((t, i) => [t.id, slots[i]])));
          pushEvents({ type: "decision_made", usedAi: false, feature: "order" });
        },

        decideInterrupt(id, decision, usedAi = false) {
          if (decision === "run_first") {
            // Put it ahead of every other task without renumbering the rest.
            const first = Math.min(0, ...get().tasks.map((t) => t.order));
            applyOrder(new Map([[id, first - 1]]));
          }
          pushEvents(
            { type: "interrupt_previewed", taskId: id, decision },
            { type: "decision_made", usedAi, feature: "interrupt" },
          );
        },

        resolveAiOrder(order, outcome) {
          if (outcome === "accepted") {
            const byId = new Map(get().tasks.map((t) => [t.id, t]));
            const tasks = order.map((id) => byId.get(id)).filter((t): t is Task => !!t && t.state === "ready");
            // Same slots as before, new sequence, so tasks in other modes don't move.
            const slots = tasks.map((t) => t.order).sort((a, b) => a - b);
            applyOrder(new Map(tasks.map((t, i) => [t.id, slots[i]])), true);
          }
          pushEvents(
            { type: "ai_suggestion", feature: "priority", outcome },
            { type: "decision_made", usedAi: true, feature: "order" },
          );
        },

        resolveAiSchedule(starts, outcome) {
          const at = now();
          const byTask = new Map(starts.map((s) => [s.taskId, s.start]));
          set((s) => ({
            tasks: s.tasks.map((t) =>
              byTask.has(t.id)
                ? { ...t, scheduledStart: byTask.get(t.id), aiPlanned: outcome === "accepted", updatedAt: at }
                : t,
            ),
          }));
          pushEvents(
            { type: "ai_suggestion", feature: "schedule", outcome },
            { type: "decision_made", usedAi: true, feature: "schedule" },
          );
        },

        logAiUse(feature) {
          pushEvents({ type: "ai_used", feature });
        },

        logPopup(feature, outcome) {
          pushEvents({ type: "popup_question", feature, outcome });
        },

        setStage(stage, reason = "manual") {
          const from = get().settings.stage;
          if (from === stage) return;
          // Log at the old stage, then switch: progress for the new stage starts fresh.
          pushEvents({ type: "stage_changed", from, to: stage, reason });
          set((s) => ({ settings: { ...s.settings, stage } }));
        },

        checkStageUp() {
          const { events, settings, startedAt } = get();
          const entered = stageEnteredAt(events, settings.stage, startedAt);
          const gate = evaluateGate(events, settings.stage, entered, now());
          if (gate.ready && gate.to) {
            get().setStage(gate.to, "auto");
            return gate.to;
          }
          return null;
        },

        updateSettings(patch) {
          set((s) => ({ settings: { ...s.settings, ...patch } }));
        },

        log(event) {
          pushEvents(event);
        },

        importData(json) {
          try {
            const parsed = JSON.parse(json) as Partial<Data> & { version?: number };
            if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.events) || !parsed.settings) {
              return err("That file isn't a MiOS export.");
            }
            set({
              tasks: parsed.tasks,
              events: parsed.events,
              settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
              startedAt: parsed.startedAt ?? now(),
            });
            return ok(undefined);
          } catch {
            return err("Couldn't read that file.");
          }
        },

        loadSample(tasks) {
          set((s) => ({ tasks: [...s.tasks, ...tasks] }));
        },

        reset() {
          set(initialData());
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      // `window.localStorage` throws on the server, which tells persist to skip storage there.
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ tasks, events, settings, startedAt }) => ({ tasks, events, settings, startedAt }),
      // Bump SCHEMA_VERSION and migrate here when the stored shape changes.
      migrate: (persisted) => persisted as Data,
    },
  ),
);

/** Serialize everything for a JSON export. */
export const exportSnapshot = (): string => {
  const { tasks, events, settings, startedAt } = useMios.getState();
  return JSON.stringify({ version: SCHEMA_VERSION, exportedAt: now(), tasks, events, settings, startedAt }, null, 2);
};
