"use client";

import { create } from "zustand";
import { CALENDAR_WINDOW, MINUTE_MS, type CalendarEvent } from "@/core";
import {
  createCalendar,
  deleteEvent,
  getCalendar,
  GoogleApiError,
  GoogleAuthError,
  googleClientId,
  hasValidToken,
  insertEvent,
  listEvents,
  requestToken,
  revokeGoogle,
  updateEvent,
  type ListResult,
} from "@/integrations/google/client";
import {
  desiredEvents,
  fromGoogle,
  GOOGLE_SOURCE,
  planPull,
  planPush,
  type GoogleLink,
} from "@/integrations/google/mapping";
import { useMios } from "./store";

/**
 * E2 — one Google Calendar sync run, and its live status. Order matters:
 *  1. make sure the MiOS calendar exists
 *  2. read changes the user made to MiOS events in Google (moves, deletes)
 *  3. write MiOS's tasks to the MiOS calendar
 *  4. read the user's main calendar
 */

export type SyncPhase = "idle" | "connecting" | "syncing" | "needs-sign-in" | "error";

interface GoogleRuntime {
  phase: SyncPhase;
  message?: string;
  /** Short summary of the last run, e.g. "3 sent, 1 moved, 42 read". */
  lastResult?: string;
}

export const useGoogleRuntime = create<GoogleRuntime>(() => ({ phase: "idle" }));

const setPhase = (phase: SyncPhase, message?: string) => useGoogleRuntime.setState({ phase, message });

const MIOS_CALENDAR_NAME = "MiOS";
let running: Promise<void> | null = null;

const windowStart = () => new Date(Date.now() - CALENDAR_WINDOW.pastDays * 24 * 60 * MINUTE_MS).toISOString();

/** Incremental read; on 410 (token too old) start over with a full read. */
const readChanges = async (calendarId: string, syncToken?: string): Promise<ListResult & { full: boolean }> => {
  if (syncToken) {
    try {
      return { ...(await listEvents(calendarId, { syncToken })), full: false };
    } catch (e) {
      if (!(e instanceof GoogleApiError && e.status === 410)) throw e;
    }
  }
  return { ...(await listEvents(calendarId, { timeMin: windowStart() })), full: true };
};

const ensureCalendar = async (): Promise<string> => {
  const g = useMios.getState().google;
  if (g.calendarId) {
    try {
      await getCalendar(g.calendarId);
      return g.calendarId;
    } catch (e) {
      // The user deleted the MiOS calendar in Google: start a fresh one.
      if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e;
      useMios.getState().updateGoogle((s) => ({ calendarId: undefined, links: {}, syncTokens: { ...s.syncTokens, [GOOGLE_SOURCE.mios]: "" } }));
    }
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { id } = await createCalendar(MIOS_CALENDAR_NAME, timeZone);
  useMios.getState().updateGoogle({ calendarId: id });
  return id;
};

/** Apply what the MiOS calendar says changed. Returns how many tasks it moved or un-planned. */
const applyMiosChanges = (result: ListResult & { full: boolean }): number => {
  const store = useMios.getState;
  const pull = planPull(result.items, store().google.links, store().tasks);
  store().applyGoogleTaskChanges(pull.moves, pull.cleared);
  store().updateGoogle((g) => {
    const links: Record<string, GoogleLink> = { ...g.links, ...pull.adopt };
    for (const id of pull.dueDeleted) if (links[id]) links[id] = { ...links[id], deletedInGoogle: true };
    // Blocks deleted in Google are gone for good: the task's plan is cleared, so nothing is pushed back.
    for (const item of result.items) if (item.status === "cancelled" && links[item.id]?.kind === "block") delete links[item.id];
    return { links };
  });
  store().applyGoogleItems({
    sourceId: GOOGLE_SOURCE.mios,
    name: "MiOS calendar (Google)",
    items: pull.others.map((g) => fromGoogle(g, GOOGLE_SOURCE.mios)).filter((e): e is CalendarEvent => !!e),
    removedIds: result.items.filter((g) => g.status === "cancelled").map((g) => g.id),
    full: result.full,
  });
  return pull.moves.length + pull.cleared.length;
};

const run = async (): Promise<void> => {
  const store = () => useMios.getState();
  setPhase("syncing");
  const calendarId = await ensureCalendar();
  let moved = 0;
  let sent = 0;

  // 2. Changes made in Google to the MiOS calendar.
  const mios = await readChanges(calendarId, store().google.syncTokens[GOOGLE_SOURCE.mios] || undefined);
  moved += applyMiosChanges(mios);

  // 3. MiOS tasks out to the MiOS calendar.
  const { tasks, settings } = store();
  const push = planPush(desiredEvents(tasks, settings), store().google.links, tasks);
  const links: Record<string, GoogleLink> = { ...store().google.links };
  for (const d of push.upserts) {
    const body = { ...d.body };
    const link = links[d.id];
    try {
      if (link) await updateEvent(calendarId, d.id, body);
      else await insertEvent(calendarId, { id: d.id, ...body });
    } catch (e) {
      if (!(e instanceof GoogleApiError)) throw e;
      // 409: the id already exists (written before this browser forgot it) → update it instead.
      // 404/410 on update: it was removed for good → create it again.
      if (e.status === 409) await updateEvent(calendarId, d.id, body);
      else if (e.status === 404 || e.status === 410) await insertEvent(calendarId, { id: d.id, ...body });
      else throw e;
    }
    links[d.id] = { taskId: d.taskId, kind: d.kind, hash: d.hash };
    sent++;
  }
  for (const id of push.deletes) {
    try {
      await deleteEvent(calendarId, id);
    } catch (e) {
      if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e;
    }
    delete links[id];
    sent++;
  }
  for (const id of push.forget) delete links[id];
  store().updateGoogle({ links });

  // Read once more: our own writes come back here (and change nothing), and the
  // token we keep then starts after them.
  const after = await readChanges(calendarId, mios.nextSyncToken);
  moved += applyMiosChanges(after);

  // 4. The user's main calendar (read-only).
  const primary = await readChanges("primary", store().google.syncTokens[GOOGLE_SOURCE.primary] || undefined);
  store().applyGoogleItems({
    sourceId: GOOGLE_SOURCE.primary,
    name: "Google Calendar",
    items: primary.items.map((g) => fromGoogle(g, GOOGLE_SOURCE.primary)).filter((e): e is CalendarEvent => !!e),
    removedIds: primary.items.filter((g) => g.status === "cancelled").map((g) => g.id),
    full: primary.full,
  });

  store().updateGoogle((g) => ({
    enabled: true,
    lastSyncAt: new Date().toISOString(),
    syncTokens: {
      ...g.syncTokens,
      ...(after.nextSyncToken ? { [GOOGLE_SOURCE.mios]: after.nextSyncToken } : {}),
      ...(primary.nextSyncToken ? { [GOOGLE_SOURCE.primary]: primary.nextSyncToken } : {}),
    },
  }));
  const read = primary.items.length;
  useGoogleRuntime.setState({
    phase: "idle",
    message: undefined,
    lastResult: [sent && `${sent} sent`, moved && `${moved} changed in Google`, `${read} read`].filter(Boolean).join(", "),
  });
};

/** Run one sync; overlapping calls share the run in progress. */
export const syncGoogle = async (): Promise<void> => {
  if (!googleClientId()) return;
  if (!hasValidToken()) {
    setPhase("needs-sign-in");
    return;
  }
  running ??= run()
    .catch((e) => {
      if (e instanceof GoogleAuthError) setPhase("needs-sign-in");
      else setPhase("error", e instanceof Error ? e.message : "Sync failed.");
    })
    .finally(() => {
      running = null;
    });
  return running;
};

/** From a click: sign in (a Google window opens), then sync. */
export const connectGoogle = async (): Promise<void> => {
  const clientId = googleClientId();
  if (!clientId) return;
  setPhase("connecting");
  try {
    await requestToken(clientId);
  } catch (e) {
    setPhase("needs-sign-in", e instanceof Error ? e.message : "Google sign-in failed.");
    return;
  }
  useMios.getState().updateGoogle({ enabled: true });
  await syncGoogle();
};

/** Revoke access and remove Google's items from MiOS. Tasks and the MiOS calendar in Google stay. */
export const disconnectGoogle = async (): Promise<void> => {
  await revokeGoogle();
  useMios.getState().disconnectGoogle();
  useGoogleRuntime.setState({ phase: "idle", message: undefined, lastResult: undefined });
};
