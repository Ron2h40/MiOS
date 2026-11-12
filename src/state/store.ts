"use client";

import { create } from "zustand";
import type { GoogleLink } from "@/integrations/google/mapping";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  autoTasksToday,
  decisionKey,
  dueOccurrences,
  makeSeries,
  pruneArchive,
  type ArchivedTask,
  ONE_OFF_FIELDS,
  seriesKeyOf,
  staleOccurrences,
  type RepeatPattern,
  type RepeatSeries,
  type RepeatTiming,
  mergeEvents,
  pruneCalendar,
  fillCalendarColors,
  nextCalendarColor,
  normalizeColor,
  taskInputFromEvent,
  taskProtectedConflicts,
  type CalendarDecision,
  type CalendarEvent,
  type CalendarSource,
  type MergeReport,
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
  pruneEntries,
  type ResourceEntry,
  type Tolerance,
  type Wrap,
  type Stage,
  type Task,
  type TaskModeId,
  type TaskResearch,
  type TaskReview,
  cleanSteps,
  reviewAnswered,
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
  source?: Task["source"];
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
  /** C2: what the user logged (food, water, sleep, medicine). */
  resourceEntries: ResourceEntry[];
  /** C4: personal tolerance per item id. */
  tolerances: Record<string, Tolerance>;
  /** D2: rewards already shown (key → when), so each fires once. */
  celebrated: Record<string, string>;
  /** D1: past stats drops, newest first, to reopen from Progress. */
  wraps: Wrap[];
  /** E1/E2: imported calendars, their events, and the morning check-in answers. */
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  calendarDecisions: Record<string, CalendarDecision>;
  /** E2: Google Calendar sync bookkeeping. The access token is never stored. */
  google: GoogleState;
  /** Repeating tasks made in MiOS. */
  repeats: RepeatSeries[];
  /** Deleted and replaced tasks, kept 30 days so they can be restored (History). */
  archive: ArchivedTask[];
}

/** Everything MiOS keeps for one person (what's saved, exported and synced). */
export type MiosData = Data;

export interface GoogleState {
  /** The user connected once; sync resumes when they press Sync. */
  enabled: boolean;
  /** The separate calendar MiOS created and writes to. */
  calendarId?: string;
  /** "What changed since last time" markers, per calendar. */
  syncTokens: Record<string, string>;
  /** What MiOS last wrote for each Google event id. */
  links: Record<string, GoogleLink>;
  lastSyncAt?: ISODateTime;
}

export const GOOGLE_INITIAL: GoogleState = { enabled: false, syncTokens: {}, links: {} };

/** One row of the morning check-in. */
export interface CalendarAnswer {
  eventKey: string;
  choice: "task" | "busy" | "skip";
  /** Repeating items: apply to every occurrence, or just this one. */
  scope: "once" | "series";
  mode: TaskModeId;
  /** Repeating items: what the item's time means for each task. */
  timing?: RepeatTiming;
  /** Optional: what the user filled in. Anything left out comes from the calendar item. */
  details?: CalendarTaskDetails;
}

export interface CalendarTaskDetails {
  title: string;
  priority: Priority;
  deadline?: ISODateTime;
  scheduledStart?: ISODateTime;
  estimateMinutes?: number;
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

  /** B6: replace a task's steps. Steps with the same title keep their tick. `own` = the user wrote them. */
  setSteps(taskId: string, titles: string[], own: boolean): void;
  toggleStep(taskId: string, stepId: string): void;
  /** B5: keep a research result with the task (newest first, up to 10). */
  addResearch(taskId: string, entry: Omit<TaskResearch, "id" | "at">): TaskResearch | null;
  /** B5: the user's own summary of a research result. */
  setResearchSummary(taskId: string, researchId: string, mine: string): void;
  removeResearch(taskId: string, researchId: string): void;
  /** B7: answers to the review after a big task, or a skip. */
  saveReview(taskId: string, review: Omit<TaskReview, "at">): void;

  setStage(stage: Stage, reason?: "auto" | "manual"): void;
  /** Move the user up a stage if every gate signal passes. Returns the new stage if it changed. */
  checkStageUp(): Stage | null;
  updateSettings(patch: Partial<Settings>): void;

  log(event: MiosEventInput): void;
  importData(json: string): Result<void>;
  loadSample(tasks: Task[]): void;

  /** C2: log an item now or at another time. Sleep takes hours slept. */
  logResource(itemId: string, opts?: { at?: ISODateTime; hours?: number }): ResourceEntry;
  removeResource(entryId: string): void;
  /** C4: set or clear (null) an item's personal tolerance. */
  setTolerance(itemId: string, tolerance: Tolerance | null): void;

  /** D1/D2: the user opened a stats drop, so remember it and never offer it again. */
  saveWrap(wrap: Wrap): void;

  /** E1: merge a parsed .ics file. Re-importing the same file changes nothing. */
  importCalendar(input: { fileName: string; name?: string; color?: string; events: CalendarEvent[] }): MergeReport;
  setCalendarColor(sourceId: string, color: string): void;
  removeCalendar(sourceId: string): void;
  /** E: the morning check-in. Each item becomes a task or busy time. */
  sortCalendarItems(answers: CalendarAnswer[]): { added: number };
  /** Ask about an item (or a whole repeating series) again. */
  forgetCalendarDecision(key: string): void;
  /** Once a day: make today's tasks for repeats (calendar and MiOS), prune old calendar items. */
  runDaily(): number;
  /** Add a task that repeats. The task is the first occurrence. */
  addRepeatingTask(input: NewTaskInput, pattern: RepeatPattern, until?: string): Task;
  /** End a series. Tasks already made stay. */
  stopRepeating(seriesId: string): void;
  /** History: bring a deleted or replaced task back. */
  restoreTask(id: string): void;
  /** History: remove an archived task for good. */
  purgeArchived(id: string): void;

  /** E2: calendar items read from Google. `full` replaces that calendar's items. */
  applyGoogleItems(input: {
    sourceId: string;
    name: string;
    /** MiOS's own calendar in Google: shown in MiOS's colour. */
    mios?: boolean;
    items: CalendarEvent[];
    removedIds: string[];
    full: boolean;
  }): void;
  /** E2: the user moved or deleted MiOS blocks in Google. Tasks are never deleted. */
  applyGoogleTaskChanges(moves: { taskId: string; start: ISODateTime }[], cleared: string[]): void;
  updateGoogle(patch: Partial<GoogleState> | ((g: GoogleState) => Partial<GoogleState>)): void;
  /** Stop syncing: Google's items leave MiOS; tasks stay. */
  disconnectGoogle(): void;
  reset(): void;
}

export type MiosStore = Data & Actions;

const now = (): ISODateTime => new Date().toISOString();
const uid = (): string => crypto.randomUUID();

/** Working on one day of a repeat (steps, research) makes it that day's own, so the next day won't replace it. */
const worked = (t: Task): Partial<Task> => (seriesKeyOf(t) ? { oneOff: true } : {});

const initialData = (): Data => ({
  tasks: [],
  events: [],
  settings: DEFAULT_SETTINGS,
  startedAt: now(),
  resourceEntries: [],
  tolerances: {},
  celebrated: {},
  wraps: [],
  calendarSources: [],
  calendarEvents: [],
  calendarDecisions: {},
  google: GOOGLE_INITIAL,
  repeats: [],
  archive: [],
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

      /**
       * A calendar item becomes a task exactly as if the user typed it: same
       * defaults, same event log. The time comes from their own calendar, so
       * landing in protected time counts as approved (and is logged).
       */
      const createFromEvent = (
        e: CalendarEvent,
        mode: TaskModeId,
        details?: CalendarTaskDetails,
        priority: Priority = 3,
        timing?: RepeatTiming,
      ): Task => {
        const input = details
          ? {
              title: details.title.trim() || e.title,
              deadline: details.deadline,
              scheduledStart: details.scheduledStart,
              estimateMinutes: details.estimateMinutes,
            }
          : taskInputFromEvent(e, timing);
        const inProtected = taskProtectedConflicts(input, get().settings).length > 0;
        return get().addTask({
          ...input,
          mode,
          priority: details?.priority ?? priority,
          protectedOverride: inProtected || undefined,
          source: { kind: "calendar", eventKey: e.key, uid: e.uid, ...(e.recurring ? { recurring: true } : {}) },
        });
      };

      /**
       * A new day of a repeating task replaces earlier days nobody touched
       * (see keepReason): started, paused, blocked, reopened, edited and
       * not-yet-due days stay. A
       * replaced day is removed (never marked done, so stats stay honest) and
       * logged. Its Google event is kept as history.
       */
      const replaceStale = (arrived: readonly Task[]) => {
        const removed = new Map<string, string>();
        for (const t of arrived) for (const old of staleOccurrences(get().tasks, t, Date.now())) removed.set(old.id, t.id);
        if (!removed.size) return;
        const at = now();
        set((s) => {
          const links = { ...s.google.links };
          for (const [id, link] of Object.entries(links)) if (removed.has(link.taskId)) delete links[id];
          return {
            archive: [
              ...s.archive,
              ...s.tasks.filter((t) => removed.has(t.id)).map((task) => ({ task, reason: "replaced" as const, at })),
            ],
            tasks: wakeUnblocked(
              s.tasks
                .filter((t) => !removed.has(t.id))
                .map((t) => ({ ...t, blockedBy: t.blockedBy.filter((b) => !(b.kind === "task" && removed.has(b.taskId))) })),
              now(),
            ),
            google: { ...s.google, links },
          };
        });
        pushEvents(...[...removed].map(([taskId, byTaskId]) => ({ type: "repeat_replaced" as const, taskId, byTaskId })));
      };

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
            ...(input.source ? { source: input.source } : {}),
          };
          set((s) => ({ tasks: [...s.tasks, task] }));
          pushEvents({ type: "task_created", taskId: task.id, mode: task.mode, isInterrupt: task.isInterrupt });
          // A9: a guess typed when the task is made is a guess too (B8 counts it as a cognitive action).
          if (task.estimateMinutes) pushEvents({ type: "time_guess", taskId: task.id, minutes: task.estimateMinutes });
          if (input.protectedOverride) {
            pushEvents({ type: "referee_override", taskId: task.id, blockLabel: "protected time" });
          }
          return task;
        },

        updateTask(id, patch) {
          const before = get().tasks.find((t) => t.id === id);
          // Changing what or when on one day of a repeating task makes that day its own.
          const oneOff =
            !!before &&
            !!seriesKeyOf(before) &&
            ONE_OFF_FIELDS.some((k) => k in patch && (patch[k] ?? undefined) !== (before[k] ?? undefined));
          replaceTask(id, (t) => ({ ...t, ...patch, ...(oneOff ? { oneOff: true } : {}), updatedAt: now() }));
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
          const gone = get().tasks.find((t) => t.id === id);
          set((s) => ({
            archive: gone ? [...s.archive, { task: gone, reason: "deleted" as const, at }] : s.archive,
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

        setSteps(taskId, titles, own) {
          const task = get().tasks.find((t) => t.id === taskId);
          if (!task) return;
          const clean = cleanSteps(titles);
          const before = new Map((task.steps ?? []).map((st) => [st.title.toLowerCase(), st]));
          const steps = clean.map((title) => {
            const old = before.get(title.toLowerCase());
            return { id: old?.id ?? uid(), title, done: old?.done ?? false };
          });
          replaceTask(taskId, (t) => ({ ...t, steps: steps.length ? steps : undefined, ...worked(t), updatedAt: now() }));
          if (own && steps.length) pushEvents({ type: "own_work", taskId, kind: "steps" });
        },

        toggleStep(taskId, stepId) {
          replaceTask(taskId, (t) => ({
            ...t,
            steps: t.steps?.map((st) => (st.id === stepId ? { ...st, done: !st.done } : st)),
            ...worked(t),
            updatedAt: now(),
          }));
        },

        addResearch(taskId, entry) {
          if (!get().tasks.some((t) => t.id === taskId)) return null;
          const item: TaskResearch = { id: uid(), at: now(), ...entry };
          replaceTask(taskId, (t) => ({ ...t, research: [item, ...(t.research ?? [])].slice(0, 10), ...worked(t), updatedAt: now() }));
          return item;
        },

        setResearchSummary(taskId, researchId, mine) {
          const text = mine.trim().slice(0, 4000);
          replaceTask(taskId, (t) => ({
            ...t,
            research: t.research?.map((r) => (r.id === researchId ? { ...r, mine: text || undefined } : r)),
            updatedAt: now(),
          }));
          if (text) pushEvents({ type: "own_work", taskId, kind: "summary" });
        },

        removeResearch(taskId, researchId) {
          replaceTask(taskId, (t) => {
            const research = t.research?.filter((r) => r.id !== researchId);
            return { ...t, research: research?.length ? research : undefined, updatedAt: now() };
          });
        },

        saveReview(taskId, review) {
          const answers = review.answers.map((a) => ({ question: a.question, answer: a.answer.trim().slice(0, 2000) }));
          const saved: TaskReview = { ...review, answers, at: now() };
          replaceTask(taskId, (t) => ({ ...t, review: saved }));
          if (reviewAnswered(saved)) pushEvents({ type: "own_work", taskId, kind: "review" });
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
              resourceEntries: Array.isArray(parsed.resourceEntries) ? parsed.resourceEntries : [],
              tolerances: parsed.tolerances ?? {},
              celebrated: parsed.celebrated ?? {},
              wraps: Array.isArray(parsed.wraps) ? parsed.wraps : [],
              calendarSources: fillCalendarColors(Array.isArray(parsed.calendarSources) ? parsed.calendarSources : []),
              calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents : [],
              calendarDecisions: parsed.calendarDecisions ?? {},
              // A different browser has no Google sign-in; keep only the MiOS calendar id so it's reused.
              google: { ...GOOGLE_INITIAL, ...(parsed.google?.calendarId ? { calendarId: parsed.google.calendarId } : {}) },
              repeats: Array.isArray(parsed.repeats) ? parsed.repeats : [],
              archive: Array.isArray(parsed.archive) ? parsed.archive : [],
            });
            return ok(undefined);
          } catch {
            return err("Couldn't read that file.");
          }
        },

        loadSample(tasks) {
          set((s) => ({ tasks: [...s.tasks, ...tasks] }));
        },

        logResource(itemId, opts = {}) {
          const entry: ResourceEntry = { id: uid(), itemId, at: opts.at ?? now(), ...(opts.hours !== undefined ? { hours: opts.hours } : {}) };
          set((s) => ({
            resourceEntries: pruneEntries([...s.resourceEntries, entry], Date.now()).sort((a, b) => a.at.localeCompare(b.at)),
          }));
          return entry;
        },

        removeResource(entryId) {
          set((s) => ({ resourceEntries: s.resourceEntries.filter((e) => e.id !== entryId) }));
        },

        setTolerance(itemId, tolerance) {
          set((s) => {
            const next = { ...s.tolerances };
            if (tolerance) next[itemId] = tolerance;
            else delete next[itemId];
            return { tolerances: next };
          });
        },

        saveWrap(wrap) {
          set((s) => ({
            celebrated: { ...s.celebrated, [wrap.key]: now() },
            wraps: [wrap, ...s.wraps.filter((w) => w.key !== wrap.key)].slice(0, 30),
          }));
        },

        importCalendar({ fileName, name, color, events }) {
          const at = now();
          const others = get().calendarSources;
          const existing = others.find((c) => c.kind === "ics" && c.fileName === fileName);
          // A colour the user picked stays; otherwise the file's own, otherwise the next free one.
          const fileColor = normalizeColor(color);
          const source: CalendarSource = existing
            ? { ...existing, name: name ?? existing.name, importedAt: at, color: existing.color ?? fileColor ?? nextCalendarColor(others) }
            : {
                id: uid(),
                kind: "ics",
                name: name ?? fileName.replace(/\.ics$/i, ""),
                fileName,
                importedAt: at,
                color: fileColor ?? nextCalendarColor(others),
              };
          const { events: merged, report } = mergeEvents(
            get().calendarEvents,
            events.map((e) => ({ ...e, sourceId: source.id })),
            get().tasks,
            Date.now(),
          );
          // A file whose items were all already here (e.g. MiOS's own export) leaves no empty calendar behind.
          const keep = !!existing || merged.some((e) => e.sourceId === source.id);
          set((s) => ({
            calendarEvents: merged,
            calendarSources: keep ? [...s.calendarSources.filter((c) => c.id !== source.id), source] : s.calendarSources,
          }));
          return report;
        },

        setCalendarColor(sourceId, color) {
          const c = normalizeColor(color);
          if (!c) return;
          set((s) => ({ calendarSources: s.calendarSources.map((x) => (x.id === sourceId ? { ...x, color: c } : x)) }));
        },

        removeCalendar(sourceId) {
          set((s) => {
            const left = s.calendarEvents.filter((e) => e.sourceId !== sourceId);
            const pruned = pruneCalendar(left, s.calendarDecisions, Date.now());
            return {
              calendarSources: s.calendarSources.filter((c) => c.id !== sourceId),
              calendarEvents: pruned.events,
              calendarDecisions: pruned.decisions,
            };
          });
        },

        sortCalendarItems(answers) {
          const at = now();
          let added = 0;
          const decisions: Record<string, CalendarDecision> = {};
          const made: Task[] = [];
          for (const a of answers) {
            const e = get().calendarEvents.find((x) => x.key === a.eventKey);
            if (!e) continue;
            const scope = e.recurring && a.choice !== "skip" ? a.scope : "once";
            const key = scope === "series" ? decisionKey.series(e) : decisionKey.once(e);
            if (a.choice === "task") {
              // Never make a second task for the same item, however often this runs.
              const already = get().tasks.find((t) => t.source?.eventKey === e.key);
              const timing = scope === "series" ? a.timing : undefined;
              const task = already ?? createFromEvent(e, a.mode, a.details, 3, timing);
              if (!already) {
                added++;
                made.push(task);
              }
              decisions[key] = { choice: "task", taskId: task.id, mode: a.mode, priority: task.priority, ...(timing ? { timing } : {}), at };
              if (scope === "series") decisions[decisionKey.once(e)] = { choice: "task", taskId: task.id, at };
            } else {
              decisions[key] = { choice: "busy", ...(a.choice === "skip" ? { skipped: true } : {}), at };
            }
          }
          set((s) => ({ calendarDecisions: { ...s.calendarDecisions, ...decisions } }));
          replaceStale(made);
          return { added };
        },

        forgetCalendarDecision(key) {
          set((s) => {
            const next = { ...s.calendarDecisions };
            delete next[key];
            return { calendarDecisions: next };
          });
        },

        addRepeatingTask(input, pattern, until) {
          const task = get().addTask(input);
          const series = makeSeries(task, pattern, { id: uid(), now: Date.now(), until });
          set((s) => ({
            repeats: [...s.repeats, series],
            tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, repeat: { seriesId: series.id, day: series.anchorDay } } : t)),
          }));
          return get().tasks.find((t) => t.id === task.id)!;
        },

        stopRepeating(seriesId) {
          set((s) => ({ repeats: s.repeats.map((r) => (r.id === seriesId && !r.stoppedAt ? { ...r, stoppedAt: now() } : r)) }));
        },

        restoreTask(id) {
          const entry = get().archive.find((a) => a.task.id === id);
          if (!entry || get().tasks.some((t) => t.id === id)) return;
          const at = now();
          set((s) => {
            const byId = new Map(s.tasks.map((t) => [t.id, t]));
            // Task blockers pointing at tasks that are gone are dropped.
            const blockedBy = entry.task.blockedBy.filter((b) => b.kind !== "task" || byId.has(b.taskId));
            const base: Task = { ...entry.task, blockedBy, runningSince: undefined, updatedAt: at };
            // A finished task comes back finished; anything else comes back to Ready (or Blocked).
            // The state change marks it as touched, so a restored repeat day isn't replaced again.
            const restored: Task =
              base.state === "done"
                ? base
                : {
                    ...base,
                    state: hasActiveBlockers(base, byId) ? "blocked" : "ready",
                    completedAt: undefined,
                    stateChangedAt: at,
                  };
            return { tasks: [...s.tasks, restored], archive: s.archive.filter((a) => a.task.id !== id) };
          });
        },

        purgeArchived(id) {
          set((s) => ({ archive: s.archive.filter((a) => a.task.id !== id) }));
        },

        runDaily() {
          const nowMs = Date.now();
          // Calendars saved before colours existed get one here.
          set((s) => ({ archive: pruneArchive(s.archive, nowMs), calendarSources: fillCalendarColors(s.calendarSources) }));
          const pruned = pruneCalendar(get().calendarEvents, get().calendarDecisions, nowMs);
          set({ calendarEvents: pruned.events, calendarDecisions: pruned.decisions });
          const due = autoTasksToday(get().calendarEvents, get().calendarDecisions, get().tasks, nowMs);
          const at = now();
          const decisions: Record<string, CalendarDecision> = {};
          const made: Task[] = [];
          for (const e of due) {
            if (get().tasks.some((t) => t.source?.eventKey === e.key)) continue;
            const series = get().calendarDecisions[decisionKey.series(e)];
            const task = createFromEvent(e, series?.mode ?? "daily-life", undefined, series?.priority, series?.timing);
            decisions[decisionKey.once(e)] = { choice: "task", taskId: task.id, at };
            made.push(task);
          }
          if (due.length) set((s) => ({ calendarDecisions: { ...s.calendarDecisions, ...decisions } }));

          // Repeating tasks made in MiOS: today's occurrence, once.
          const occurrences = dueOccurrences(get().repeats, get().tasks, nowMs);
          for (const o of occurrences) {
            const task = get().addTask({
              title: o.title,
              mode: o.mode,
              priority: o.priority,
              scheduledStart: o.scheduledStart,
              deadline: o.deadline,
            });
            set((s) => ({ tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, repeat: { seriesId: o.seriesId, day: o.day } } : t)) }));
            made.push(get().tasks.find((t) => t.id === task.id)!);
          }
          replaceStale(made);
          return due.length + occurrences.length;
        },

        applyGoogleItems({ sourceId, name, mios, items, removedIds, full }) {
          set((s) => {
            const removed = new Set(removedIds);
            const kept = s.calendarEvents.filter((e) =>
              full ? e.sourceId !== sourceId : !(e.externalId && removed.has(e.externalId)),
            );
            const { events } = mergeEvents(kept, items.map((e) => ({ ...e, sourceId })), s.tasks, Date.now());
            const old = s.calendarSources.find((c) => c.id === sourceId);
            const has = !!old;
            const source: CalendarSource = {
              id: sourceId,
              kind: "google",
              name,
              importedAt: now(),
              ...(mios ? { mios: true } : { color: old?.color ?? nextCalendarColor(s.calendarSources) }),
            };
            return {
              calendarEvents: events,
              calendarSources: has ? s.calendarSources.map((c) => (c.id === sourceId ? source : c)) : [...s.calendarSources, source],
            };
          });
        },

        applyGoogleTaskChanges(moves, cleared) {
          if (!moves.length && !cleared.length) return;
          const at = now();
          const startById = new Map(moves.map((m) => [m.taskId, m.start]));
          const clear = new Set(cleared);
          set((s) => ({
            tasks: s.tasks.map((t) => {
              // Moving or deleting one day of a repeat in Google makes that day its own, as an edit in MiOS would.
              const oneOff = seriesKeyOf(t) ? { oneOff: true } : {};
              if (clear.has(t.id)) return { ...t, scheduledStart: undefined, protectedOverride: undefined, ...oneOff, updatedAt: at };
              // Moved by the user in their own calendar: their own plan now.
              if (startById.has(t.id)) return { ...t, scheduledStart: startById.get(t.id), aiPlanned: false, ...oneOff, updatedAt: at };
              return t;
            }),
          }));
        },

        updateGoogle(patch) {
          set((s) => ({ google: { ...s.google, ...(typeof patch === "function" ? patch(s.google) : patch) } }));
        },

        disconnectGoogle() {
          set((s) => {
            const left = s.calendarEvents.filter((e) => !e.sourceId.startsWith("google:"));
            const pruned = pruneCalendar(left, s.calendarDecisions, Date.now());
            return {
              calendarEvents: pruned.events,
              calendarDecisions: pruned.decisions,
              calendarSources: s.calendarSources.filter((c) => c.kind !== "google"),
              // Keep the calendar id: reconnecting reuses the same MiOS calendar instead of making another.
              google: { ...GOOGLE_INITIAL, calendarId: s.google.calendarId },
            };
          });
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
      partialize: ({
        tasks,
        events,
        settings,
        startedAt,
        resourceEntries,
        tolerances,
        celebrated,
        wraps,
        calendarSources,
        calendarEvents,
        calendarDecisions,
        google,
        repeats,
        archive,
      }) => ({
        tasks,
        events,
        settings,
        startedAt,
        resourceEntries,
        tolerances,
        celebrated,
        wraps,
        calendarSources,
        calendarEvents,
        calendarDecisions,
        google,
        repeats,
        archive,
      }),
      // Bump SCHEMA_VERSION and migrate here when the stored shape changes.
      migrate: (persisted) => persisted as Data,
    },
  ),
);

/** Serialize everything for a JSON export. */
export const exportSnapshot = (): string => {
  const s = useMios.getState();
  const { tasks, events, settings, startedAt, resourceEntries, tolerances, celebrated, wraps } = s;
  const { calendarSources, calendarEvents, calendarDecisions, google, repeats, archive } = s;
  return JSON.stringify(
    {
      version: SCHEMA_VERSION,
      exportedAt: now(),
      tasks,
      events,
      settings,
      startedAt,
      resourceEntries,
      tolerances,
      celebrated,
      wraps,
      calendarSources,
      calendarEvents,
      calendarDecisions,
      google: { calendarId: google.calendarId },
      repeats,
      archive,
    },
    null,
    2,
  );
};
