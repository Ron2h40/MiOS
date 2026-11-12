import { MINUTE_MS, toMs } from "./time";
import type { ISODateTime, Priority, Task, TaskModeId } from "./types";

/**
 * Section E: the one shared calendar (A8 glue). Events come in from .ics
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
  /** The colour this calendar's items show in (#rrggbb). MiOS's own items use the app accent. */
  color?: string;
  /** MiOS's own calendar kept in an outside service: it shows in MiOS's colour, not one of its own. */
  mios?: boolean;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/**
 * Colours for outside calendars, picked to read on light and dark
 * backgrounds. There's no blue: blue is MiOS's own.
 */
export const CALENDAR_COLORS = ["#e8590c", "#2f9e44", "#ae3ec9", "#d6336c", "#0c8599", "#e8a400", "#c92a2a", "#868e96"] as const;

/** A colour from a calendar file (#rgb, #rrggbb or #rrggbbaa) as #rrggbb. Anything else is ignored. */
export const normalizeColor = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw.trim());
  if (!m) return undefined;
  const hex = m[1].toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6)}`;
};

/** The first colour no calendar uses yet; once all are taken, they go round again. */
export const nextCalendarColor = (sources: readonly Pick<CalendarSource, "color">[]): string => {
  const used = new Set(sources.map((c) => c.color));
  return CALENDAR_COLORS.find((c) => !used.has(c)) ?? CALENDAR_COLORS[sources.length % CALENDAR_COLORS.length];
};

/** Every calendar with a colour. Calendars that have one keep it; the list comes back as is if nothing was missing. */
export const fillCalendarColors = (sources: readonly CalendarSource[]): CalendarSource[] => {
  if (sources.every((c) => c.color || c.mios)) return sources as CalendarSource[];
  const taken: CalendarSource[] = sources.filter((c) => c.color);
  return sources.map((c) => {
    if (c.color || c.mios) return c;
    const filled = { ...c, color: nextCalendarColor(taken) };
    taken.push(filled);
    return filled;
  });
};

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
  /** For repeating items: what the item's time means for each task. */
  timing?: RepeatTiming;
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

/**
 * An item's key split into its UID and, for one occurrence of a repeat, the
 * original start. Only a real date after the last "|" counts, since a UID
 * can contain "|" itself.
 */
export const splitKey = (key: string): { uid: string; original?: ISODateTime } => {
  const i = key.lastIndexOf("|");
  const original = i > 0 ? key.slice(i + 1) : "";
  return original && !Number.isNaN(Date.parse(original)) ? { uid: key.slice(0, i), original } : { uid: key };
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

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Calendar items that go into an export next to MiOS's own tasks, from the
 * chosen calendars. MiOS's own calendar in an outside service always comes
 * along, since it's part of MiOS. An item that has a MiOS task is left out:
 * the task is exported as MiOS's, so it appears once. So are copies of
 * MiOS's own exports that came back in through a calendar, and any item a
 * second time under another id.
 */
export const exportableEvents = (
  events: readonly CalendarEvent[],
  sources: readonly Pick<CalendarSource, "id" | "mios">[],
  tasks: readonly Task[],
  include: readonly string[],
): CalendarEvent[] => {
  const chosen = new Set([...include, ...sources.filter((c) => c.mios).map((c) => c.id)]);
  const known = new Set(sources.map((c) => c.id));
  const seen = new Set<string>();
  return events.filter((e) => {
    if (!chosen.has(e.sourceId) || !known.has(e.sourceId)) return false;
    if (e.miosTaskId || taskIdFromUid(e.uid) || linkedTaskId(e, tasks)) return false;
    const print = eventFingerprint(e);
    if (seen.has(e.key) || seen.has(print)) return false;
    seen.add(e.key);
    seen.add(print);
    return true;
  });
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
  /** The calendar it's on, by name. */
  calendar?: string;
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
  sources: readonly Pick<CalendarSource, "id" | "name">[] = [],
): BusyInterval[] => {
  const names = new Map(sources.map((c) => [c.id, c.name]));
  return events
    .filter((e) => !e.allDay && !e.free)
    .filter((e) => {
      const k = calendarStatus(e, decisions, tasks).kind;
      return k === "busy" || k === "pending";
    })
    .map((e) => {
      const calendar = names.get(e.sourceId);
      return { id: e.key, label: e.title, ...(calendar ? { calendar } : {}), start: e.start, end: e.end };
    });
};

/**
 * What a repeating item's time means ("How do you want it repeated?"):
 *  - "start": do it at that time (planned start)
 *  - "due": it's due at that time (deadline, no planned start)
 *  - "both": do it then, due by the end
 */
export type RepeatTiming = "start" | "due" | "both";

/** The task an event becomes: same as one the user typed, minus the typing. */
export const taskInputFromEvent = (
  e: CalendarEvent,
  timing: RepeatTiming = "start",
): { title: string; scheduledStart?: ISODateTime; deadline?: ISODateTime } => {
  if (e.allDay) {
    // All-day items (like "Essay due") become a deadline at the end of that day.
    const day = new Date(toMs(e.start));
    return { title: e.title, deadline: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59).toISOString() };
  }
  if (timing === "due") return { title: e.title, deadline: e.start };
  if (timing === "both") return { title: e.title, scheduledStart: e.start, deadline: e.end };
  return { title: e.title, scheduledStart: e.start };
};
