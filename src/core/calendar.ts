import { MINUTE_MS, toMs } from "./time";
import type { ISODateTime, Priority, Task, TaskModeId } from "./types";

/**
 * Section E — the one shared calendar (A8 glue). Events come in from .ics
 * files or Google Calendar. Each morning the user sorts today's items: an
 * item either becomes a normal MiOS task, or it's busy time the referee
 * protects. Nothing here talks to a file or a network; it's plain rules.
 *
 * Duplicates are the main risk (the same file imported many times, a MiOS
 * export imported back, two calendars holding the same event), so every
 * event has two identities and both are checked:
 *  - `key`: the calendar's own id (iCal UID, plus the occurrence for repeats)
 *  - `fingerprint`: normalized title + start + end, for when ids get rewritten
 */

export interface CalendarEvent {
  /** Unique per occurrence: UID for one-off events, UID + original start for repeats. */
  key: string;
  /** The iCal UID; shared by every occurrence of a repeating event. */
  uid: string;
  recurring: boolean;
  title: string;
  start: ISODateTime;
  end: ISODateTime;
  allDay: boolean;
  location?: string;
  /** The calendar marks this time as free (TRANSP:TRANSPARENT). */
  free?: boolean;
  /** Which imported calendar it came from. */
  sourceId: string;
  /** Set when this event was exported by MiOS for one of its own tasks. */
  miosTaskId?: string;
  /** The event's id in an outside service (Google), to apply deletions. */
  externalId?: string;
}

export interface CalendarSource {
  id: string;
  kind: "ics" | "google";
  name: string;
  /** For .ics files: the file's own name, to recognise a re-import. */
  fileName?: string;
  importedAt: ISODateTime;
}

/** The morning check-in answer for an item. */
export interface CalendarDecision {
  choice: "task" | "busy";
  /** Skipped items are busy time, but repeating ones get asked again next time. */
  skipped?: boolean;
  /** The task this item became. */
  taskId?: string;
  /** For "always add" series: the mode and priority each new occurrence gets. */
  mode?: TaskModeId;
  priority?: Priority;
  at: ISODateTime;
}

/** Answers are stored per occurrence ("once") or for every occurrence ("series"). */
export const decisionKey = {
  once: (e: Pick<CalendarEvent, "key">) => `once:${e.key}`,
  series: (e: Pick<CalendarEvent, "uid">) => `series:${e.uid}`,
};

export type Decisions = Readonly<Record<string, CalendarDecision>>;

/** How far around today imported events are kept. */
export const CALENDAR_WINDOW = { pastDays: 30, futureDays: 180 } as const;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const normTitle = (t: string) => t.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Same title, same start, same end: the same thing, whatever its id says. */
export const fingerprint = (title: string, start: ISODateTime, end?: ISODateTime): string =>
  `${normTitle(title)}|${toMs(start)}|${end ? toMs(end) : ""}`;

export const eventFingerprint = (e: Pick<CalendarEvent, "title" | "start" | "end">) => fingerprint(e.title, e.start, e.end);

/** UIDs MiOS writes on export. `task-…` is a planned block, `due-…` a deadline. */
export const miosUid = {
  block: (taskId: string) => `task-${taskId}@mios`,
  due: (taskId: string) => `due-${taskId}@mios`,
};

/** The task id behind a MiOS-written UID, or undefined. */
export const taskIdFromUid = (uid: string): string | undefined => /^(?:task|due)-(.+)@mios$/i.exec(uid.trim())?.[1];

/** Ways a task can already be on a calendar: its planned block and its deadline. */
const taskFingerprints = (tasks: readonly Task[]): Map<string, string> => {
  const out = new Map<string, string>();
  for (const t of tasks) {
    if (t.scheduledStart) out.set(fingerprint(t.title, t.scheduledStart), t.id);
    if (t.deadline) out.set(fingerprint(`Due: ${t.title}`, t.deadline), t.id);
  }
  return out;
};

/** Fingerprint without the end time, for matching tasks (their length is a guess). */
const startPrint = (e: Pick<CalendarEvent, "title" | "start">) => fingerprint(e.title, e.start);

/** The MiOS task an event stands for, if any. */
export const linkedTaskId = (e: CalendarEvent, tasks: readonly Task[]): string | undefined => {
  const byId = new Set(tasks.map((t) => t.id));
  if (e.miosTaskId && byId.has(e.miosTaskId)) return e.miosTaskId;
  const fromCalendar = tasks.find((t) => t.source?.eventKey === e.key);
  if (fromCalendar) return fromCalendar.id;
  return taskFingerprints(tasks).get(startPrint(e));
};

// ---------------------------------------------------------------------------
// Merging an import
// ---------------------------------------------------------------------------

export interface MergeReport {
  added: number;
  updated: number;
  /** Already present under another id (same title and time). */
  duplicates: number;
  /** MiOS's own tasks coming back; matched, never copied. */
  alreadyInMios: number;
  /** Outside the kept window. */
  outOfRange: number;
}

export interface MergeResult {
  events: CalendarEvent[];
  report: MergeReport;
}

/**
 * Merge incoming events into the stored list. Safe to run any number of
 * times with the same input: the result doesn't change after the first run.
 */
export const mergeEvents = (
  existing: readonly CalendarEvent[],
  incoming: readonly CalendarEvent[],
  tasks: readonly Task[],
  now: number,
): MergeResult => {
  const report: MergeReport = { added: 0, updated: 0, duplicates: 0, alreadyInMios: 0, outOfRange: 0 };
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const keyByPrint = new Map(existing.map((e) => [eventFingerprint(e), e.key]));
  const from = now - CALENDAR_WINDOW.pastDays * 24 * 60 * MINUTE_MS;
  const to = now + CALENDAR_WINDOW.futureDays * 24 * 60 * MINUTE_MS;
  const seen = new Set<string>();

  for (const e of incoming) {
    if (toMs(e.end) < from || toMs(e.start) > to) {
      report.outOfRange++;
      continue;
    }
    if (linkedTaskId(e, tasks) && (e.miosTaskId || taskIdFromUid(e.uid))) {
      report.alreadyInMios++;
      continue;
    }
    const print = eventFingerprint(e);
    if (seen.has(e.key) || seen.has(`p:${print}`)) {
      report.duplicates++;
      continue;
    }
    seen.add(e.key);
    seen.add(`p:${print}`);

    const sameKey = byKey.get(e.key);
    if (sameKey) {
      const changed =
        sameKey.title !== e.title || sameKey.start !== e.start || sameKey.end !== e.end || sameKey.location !== e.location;
      if (changed) {
        keyByPrint.delete(eventFingerprint(sameKey));
        byKey.set(e.key, { ...e, sourceId: sameKey.sourceId });
        keyByPrint.set(print, e.key);
        report.updated++;
      } else report.duplicates++;
      continue;
    }
    if (keyByPrint.has(print)) {
      report.duplicates++;
      continue;
    }
    byKey.set(e.key, e);
    keyByPrint.set(print, e.key);
    report.added++;
  }

  return { events: [...byKey.values()].sort((a, b) => a.start.localeCompare(b.start)), report };
};

/** Drop events that ended before the kept window, and answers that only pointed at them. */
export const pruneCalendar = (
  events: readonly CalendarEvent[],
  decisions: Decisions,
  now: number,
): { events: CalendarEvent[]; decisions: Record<string, CalendarDecision> } => {
  const from = now - CALENDAR_WINDOW.pastDays * 24 * 60 * MINUTE_MS;
  const kept = events.filter((e) => toMs(e.end) >= from);
  const keys = new Set(kept.map((e) => decisionKey.once(e)));
  const uids = new Set(kept.map((e) => decisionKey.series(e)));
  const next: Record<string, CalendarDecision> = {};
  for (const [k, d] of Object.entries(decisions)) {
    if (keys.has(k) || uids.has(k)) next[k] = d;
  }
  return { events: kept, decisions: next };
};

// ---------------------------------------------------------------------------
// Sorting (the morning check-in) and busy time
// ---------------------------------------------------------------------------

export const decisionFor = (e: CalendarEvent, decisions: Decisions): CalendarDecision | undefined =>
  decisions[decisionKey.once(e)] ?? (e.recurring ? decisions[decisionKey.series(e)] : undefined);

export type CalendarStatus =
  /** It's a MiOS task (came from MiOS, or the user added it). */
  | { kind: "task"; taskId: string }
  /** Busy time the user confirmed, or skipped. */
  | { kind: "busy"; skipped: boolean }
  /** A repeating item the user always adds; today's copy becomes a task automatically. */
  | { kind: "auto-task" }
  /** Not sorted yet. Counts as busy time until it is. */
  | { kind: "pending" };

export const calendarStatus = (e: CalendarEvent, decisions: Decisions, tasks: readonly Task[]): CalendarStatus => {
  const linked = linkedTaskId(e, tasks);
  if (linked) return { kind: "task", taskId: linked };
  const d = decisionFor(e, decisions);
  if (!d) return { kind: "pending" };
  if (d.choice === "busy") return { kind: "busy", skipped: !!d.skipped };
  // Answered "task" but the task is gone (deleted): a once-answer stays settled,
  // a series answer makes a fresh task for each new occurrence.
  return decisions[decisionKey.once(e)] ? { kind: "busy", skipped: false } : { kind: "auto-task" };
};

const localDayBounds = (now: number): [number, number] => {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return [start, end];
};

/** Today's events that touch the local day. */
export const eventsOnDay = (events: readonly CalendarEvent[], now: number): CalendarEvent[] => {
  const [start, end] = localDayBounds(now);
  return events.filter((e) => toMs(e.start) < end && toMs(e.end) > start);
};

/** The check-in list: today's items not sorted yet. */
export const pendingToday = (
  events: readonly CalendarEvent[],
  decisions: Decisions,
  tasks: readonly Task[],
  now: number,
): CalendarEvent[] => eventsOnDay(events, now).filter((e) => calendarStatus(e, decisions, tasks).kind === "pending");

/** Today's occurrences of series the user always adds, still without a task. */
export const autoTasksToday = (
  events: readonly CalendarEvent[],
  decisions: Decisions,
  tasks: readonly Task[],
  now: number,
): CalendarEvent[] => eventsOnDay(events, now).filter((e) => calendarStatus(e, decisions, tasks).kind === "auto-task");

export interface BusyInterval {
  id: string;
  label: string;
  start: ISODateTime;
  end: ISODateTime;
}

/**
 * Time the referee protects. Everything not sorted into MiOS counts, except
 * all-day items and items the calendar itself marks as free (birthdays,
 * holidays, reminders), which would otherwise block whole days.
 */
export const busyIntervals = (
  events: readonly CalendarEvent[],
  decisions: Decisions,
  tasks: readonly Task[],
): BusyInterval[] =>
  events
    .filter((e) => !e.allDay && !e.free)
    .filter((e) => {
      const k = calendarStatus(e, decisions, tasks).kind;
      return k === "busy" || k === "pending";
    })
    .map((e) => ({ id: e.key, label: e.title, start: e.start, end: e.end }));

/** The task an event becomes: same as one the user typed, minus the typing. */
export const taskInputFromEvent = (
  e: CalendarEvent,
): { title: string; scheduledStart?: ISODateTime; deadline?: ISODateTime } => {
  if (!e.allDay) return { title: e.title, scheduledStart: e.start };
  // All-day items (like "Essay due") become a deadline at the end of that day.
  const day = new Date(toMs(e.start));
  return { title: e.title, deadline: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59).toISOString() };
};
