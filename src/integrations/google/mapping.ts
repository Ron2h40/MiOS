import { MINUTE_MS, type CalendarEvent, type Settings, type Task } from "@/core";
import { DUE_MARKER_MINUTES } from "../ics";

/**
 * E2 — pure rules for Google Calendar sync: turning Google events into MiOS
 * calendar items, and deciding what MiOS writes back. No network here, so
 * every rule is unit-tested.
 *
 * Reading: the user's main calendar, read-only.
 * Writing: only a separate "MiOS" calendar that MiOS creates.
 */

export const GOOGLE_SOURCE = {
  primary: "google:primary",
  mios: "google:mios",
} as const;

/** The subset of a Google Calendar event resource MiOS uses. */
export interface GEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  location?: string;
  start?: GEventTime;
  end?: GEventTime;
  iCalUID?: string;
  recurringEventId?: string;
  originalStartTime?: GEventTime;
  transparency?: "opaque" | "transparent";
  extendedProperties?: { private?: Record<string, string> };
}

export type MiosKind = "block" | "due";

/** Private fields MiOS puts on the events it writes. */
export const MIOS_PROP = { taskId: "miosTaskId", kind: "miosKind" } as const;

/** "YYYY-MM-DD" all-day dates are local days. */
const localDay = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toISOString();
};

const timeOf = (t: GEventTime | undefined): string | undefined =>
  t?.dateTime ? new Date(t.dateTime).toISOString() : t?.date ? localDay(t.date) : undefined;

/**
 * A Google event as a MiOS calendar item, or null if it's cancelled or has no
 * time. The key matches what the .ics reader makes for the same event (UID,
 * plus the original start for repeats), so a calendar imported as a file and
 * then synced is still one item.
 */
export const fromGoogle = (g: GEvent, sourceId: string): CalendarEvent | null => {
  if (g.status === "cancelled") return null;
  const start = timeOf(g.start);
  if (!start) return null;
  const end = timeOf(g.end) ?? start;
  const uid = g.iCalUID ?? g.id;
  const original = timeOf(g.originalStartTime);
  const miosTaskId = g.extendedProperties?.private?.[MIOS_PROP.taskId];
  return {
    key: g.recurringEventId && original ? `${uid}|${original}` : uid,
    uid,
    recurring: !!g.recurringEventId,
    title: (g.summary || "(No title)").trim(),
    start,
    end,
    allDay: !!g.start?.date,
    ...(g.location ? { location: g.location } : {}),
    ...(g.transparency === "transparent" ? { free: true } : {}),
    sourceId,
    ...(miosTaskId ? { miosTaskId } : {}),
    externalId: g.id,
  };
};

/**
 * MiOS chooses each event's Google id, so the same task always maps to the
 * same event: writing it twice can't make a copy, even if this browser forgot
 * everything. Google ids allow a–v and 0–9 (base32hex), 5–1024 characters.
 */
export const googleEventId = (kind: MiosKind, taskId: string): string =>
  `mios${kind === "block" ? "b" : "d"}${taskId.toLowerCase().replace(/[^0-9a-v]/g, "")}`;

export interface DesiredEvent {
  id: string;
  taskId: string;
  kind: MiosKind;
  body: {
    summary: string;
    start: { dateTime: string };
    end: { dateTime: string };
    extendedProperties: { private: Record<string, string> };
  };
  /** Changes when anything MiOS writes changes. */
  hash: string;
}

/** What MiOS last wrote for each event id. */
export interface GoogleLink {
  taskId: string;
  kind: MiosKind;
  hash: string;
  /** The user deleted this "Due" marker in Google; don't put it back unless the deadline changes. */
  deletedInGoogle?: boolean;
}

export type GoogleLinks = Readonly<Record<string, GoogleLink>>;

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Events MiOS should have in the MiOS calendar: a block for each unfinished
 * task with a planned start (as long as the time guess), and a "Due" marker
 * per deadline. Tasks made from a calendar item are left out: they're already
 * on the user's calendar, and a second copy would be a duplicate there.
 */
export const desiredEvents = (
  tasks: readonly Task[],
  settings: Pick<Settings, "defaultEstimateMinutes">,
): DesiredEvent[] => {
  const out: DesiredEvent[] = [];
  const add = (kind: MiosKind, t: Task, summary: string, startMs: number, minutes: number) => {
    const body = {
      summary,
      start: { dateTime: iso(startMs) },
      end: { dateTime: iso(startMs + minutes * MINUTE_MS) },
      extendedProperties: { private: { [MIOS_PROP.taskId]: t.id, [MIOS_PROP.kind]: kind } },
    };
    out.push({ id: googleEventId(kind, t.id), taskId: t.id, kind, body, hash: `${summary}|${body.start.dateTime}|${body.end.dateTime}` });
  };
  for (const t of tasks) {
    if (t.state === "done" || t.source) continue;
    if (t.scheduledStart) add("block", t, t.title, Date.parse(t.scheduledStart), t.estimateMinutes ?? settings.defaultEstimateMinutes);
    if (t.deadline) add("due", t, `Due: ${t.title}`, Date.parse(t.deadline), DUE_MARKER_MINUTES);
  }
  return out;
};

export interface PushPlan {
  /** Create or change these. */
  upserts: DesiredEvent[];
  /** Delete these event ids (the task was deleted, or its plan or deadline removed). */
  deletes: string[];
  /** Stop tracking these without touching Google (finished tasks keep their history). */
  forget: string[];
}

export const planPush = (desired: readonly DesiredEvent[], links: GoogleLinks, tasks: readonly Task[]): PushPlan => {
  const want = new Map(desired.map((d) => [d.id, d]));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const plan: PushPlan = { upserts: [], deletes: [], forget: [] };
  for (const d of desired) {
    const link = links[d.id];
    if (!link || link.hash !== d.hash) plan.upserts.push(d);
  }
  for (const [id, link] of Object.entries(links)) {
    if (want.has(id)) continue;
    const task = byId.get(link.taskId);
    if (task?.state === "done" || link.deletedInGoogle) plan.forget.push(id);
    else plan.deletes.push(id);
  }
  return plan;
};

export interface PullPlan {
  /** The user moved a MiOS block in Google: move the task's planned start. */
  moves: { taskId: string; start: string }[];
  /** The user deleted a MiOS block in Google: clear the plan, never the task. */
  cleared: string[];
  /** "Due" markers the user deleted in Google. */
  dueDeleted: string[];
  /** MiOS events found in Google that this browser wasn't tracking (e.g. after clearing data). */
  adopt: Record<string, GoogleLink>;
  /** Events the user made in the MiOS calendar themselves: ordinary calendar items. */
  others: GEvent[];
}

/** Changes read back from the MiOS calendar. */
export const planPull = (changes: readonly GEvent[], links: GoogleLinks, tasks: readonly Task[]): PullPlan => {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const plan: PullPlan = { moves: [], cleared: [], dueDeleted: [], adopt: {}, others: [] };
  for (const g of changes) {
    const props = g.extendedProperties?.private;
    const link: GoogleLink | undefined =
      links[g.id] ??
      (props?.[MIOS_PROP.taskId]
        ? { taskId: props[MIOS_PROP.taskId], kind: props[MIOS_PROP.kind] === "due" ? "due" : "block", hash: "" }
        : undefined);
    if (!link) {
      // Deleted events only carry their id; an untracked one is nothing to MiOS.
      if (g.status !== "cancelled") plan.others.push(g);
      continue;
    }
    if (!links[g.id] && g.status !== "cancelled") {
      plan.adopt[g.id] = { ...link, hash: `${g.summary ?? ""}|${timeOf(g.start) ?? ""}|${timeOf(g.end) ?? ""}` };
    }
    const task = byId.get(link.taskId);
    if (link.kind === "due") {
      // Deadlines go one way: MiOS is where they're set.
      if (g.status === "cancelled") plan.dueDeleted.push(g.id);
      continue;
    }
    if (!task || task.state === "done") continue;
    if (g.status === "cancelled") {
      if (task.scheduledStart) plan.cleared.push(task.id);
      continue;
    }
    const start = timeOf(g.start);
    if (start && task.scheduledStart && Date.parse(start) !== Date.parse(task.scheduledStart)) {
      plan.moves.push({ taskId: task.id, start });
    }
  }
  return plan;
};
