import ICAL from "ical.js";
import {
  CALENDAR_WINDOW,
  MINUTE_MS,
  miosUid,
  taskIdFromUid,
  type CalendarEvent,
  type Settings,
  type Task,
} from "@/core";

/**
 * E1 — .ics import and export (RFC 5545). Reading uses ical.js, which handles
 * time zones and repeat rules. Writing is small enough to do by hand.
 */

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ParsedCalendar {
  name?: string;
  events: CalendarEvent[];
}

/** Hard stop so a huge or looping repeat rule can't freeze the tab. */
const MAX_OCCURRENCES_PER_EVENT = 500;
const MAX_EVENTS = 5000;

/** Small stable hash for events that arrive without a UID. */
const hash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const iso = (t: ICAL.Time): string => t.toJSDate().toISOString();

export const parseIcs = (text: string, sourceId: string, now: number): ParsedCalendar => {
  const root = new ICAL.Component(ICAL.parse(text));
  // Files carry their own time-zone definitions; register them so TZIDs resolve.
  for (const tz of root.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);

  const windowStart = ICAL.Time.fromJSDate(new Date(now - CALENDAR_WINDOW.pastDays * 24 * 60 * MINUTE_MS), true);
  const windowEnd = now + CALENDAR_WINDOW.futureDays * 24 * 60 * MINUTE_MS;

  // Group by UID: one master plus any edited occurrences (RECURRENCE-ID).
  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Event[] = [];
  for (const vevent of root.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(vevent);
    if (!ev.startDate) continue;
    const uid = ev.uid?.trim() || `nouid-${hash(`${ev.summary}|${ev.startDate.toString()}`)}`;
    if (!ev.uid) ev.uid = uid;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(uid, ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    // An edited occurrence without its series still counts as a one-off.
    else masters.set(`${ex.uid}|${iso(ex.recurrenceId)}`, ex);
  }

  const events: CalendarEvent[] = [];
  const make = (ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time, key: string, recurring: boolean): CalendarEvent => {
    const uid = ev.uid.trim();
    const transp = ev.component.getFirstPropertyValue("transp");
    const miosTaskId =
      (ev.component.getFirstPropertyValue("x-mios-task-id") as string | null) ?? taskIdFromUid(uid) ?? undefined;
    return {
      key,
      uid,
      recurring,
      title: (ev.summary || "(No title)").trim(),
      start: iso(start),
      end: iso(end),
      allDay: start.isDate,
      ...(ev.location ? { location: ev.location } : {}),
      ...(String(transp).toUpperCase() === "TRANSPARENT" ? { free: true } : {}),
      sourceId,
      ...(miosTaskId ? { miosTaskId } : {}),
    };
  };

  for (const [mapKey, ev] of masters) {
    if (events.length >= MAX_EVENTS) break;
    const status = String(ev.component.getFirstPropertyValue("status") ?? "").toUpperCase();
    if (status === "CANCELLED") continue;

    if (!ev.isRecurring()) {
      const end = ev.endDate ?? ev.startDate;
      events.push(make(ev, ev.startDate, end, mapKey, false));
      continue;
    }

    const it = ev.iterator();
    for (let n = 0, next = it.next(); next && n < MAX_OCCURRENCES_PER_EVENT; next = it.next(), n++) {
      if (next.toJSDate().getTime() > windowEnd) break;
      const occ = ev.getOccurrenceDetails(next);
      if (occ.endDate.compare(windowStart) < 0) continue;
      const item = occ.item;
      const cancelled = String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
      if (cancelled) continue;
      events.push(make(item, occ.startDate, occ.endDate, `${ev.uid.trim()}|${iso(occ.recurrenceId)}`, true));
    }
  }

  const name = root.getFirstPropertyValue("x-wr-calname");
  return { ...(name ? { name: String(name) } : {}), events };
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Escape TEXT values (RFC 5545 §3.3.11). */
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[;,]/g, (c) => `\\${c}`);

/** Fold lines at 75 octets (RFC 5545 §3.1). */
const fold = (line: string): string => {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
};

const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export interface ExportOptions {
  includeDeadlines: boolean;
}

/** How long a deadline marker is in other calendars. */
export const DUE_MARKER_MINUTES = 15;

/**
 * Every unfinished task with a planned start (a block as long as the time
 * guess) and, optionally, every deadline (a short "Due: …" marker). UIDs are
 * stable, so importing the file anywhere twice updates instead of duplicating,
 * and importing it back into MiOS is recognised as MiOS's own tasks.
 */
export const buildIcs = (
  tasks: readonly Task[],
  settings: Pick<Settings, "defaultEstimateMinutes">,
  opts: ExportOptions,
  now: number,
): { ics: string; count: number } => {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MiOS//MiOS v1//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:MiOS"];
  let count = 0;
  const stamp = utc(now);
  const vevent = (uid: string, taskId: string, title: string, start: number, minutes: number, updated: string) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${utc(Date.parse(updated))}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(start + minutes * MINUTE_MS)}`,
      `SUMMARY:${text(title)}`,
      `X-MIOS-TASK-ID:${taskId}`,
      "END:VEVENT",
    );
    count++;
  };

  for (const t of tasks) {
    if (t.state === "done") continue;
    if (t.scheduledStart) {
      vevent(miosUid.block(t.id), t.id, t.title, Date.parse(t.scheduledStart), t.estimateMinutes ?? settings.defaultEstimateMinutes, t.updatedAt);
    }
    if (opts.includeDeadlines && t.deadline) {
      vevent(miosUid.due(t.id), t.id, `Due: ${t.title}`, Date.parse(t.deadline), DUE_MARKER_MINUTES, t.updatedAt);
    }
  }
  lines.push("END:VCALENDAR");
  return { ics: lines.map(fold).join("\r\n") + "\r\n", count };
};
