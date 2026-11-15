import type { MiosEvent } from "@/core";
import type { Merge } from "@/integrations/firebase/reconcile";
import type { AnalysisEntry } from "./ai";
import type { MiosData } from "./store";

/**
 * How MiOS's saved data maps onto synced collections. Pure, so the mapping
 * can be tested without Firebase. Each collection reads items (id → JSON)
 * from the state and applies changes back to it.
 */

export interface Collection<S> {
  /** Firestore collection name, also listed in firestore.rules. */
  name: string;
  read(state: S): Map<string, string>;
  /** A partial state with the changes applied (JSON to set, null to delete). */
  apply(state: S, changes: ReadonlyMap<string, string | null>): Partial<S>;
  /** For items changed on two devices at once. Default: the account's copy wins. */
  merge?: Merge;
}

/** JSON per object, cached by identity: the store replaces changed objects, so unchanged ones aren't re-serialized. */
const cache = new WeakMap<object, string>();
const json = (v: unknown): string => {
  if (typeof v !== "object" || v === null) return JSON.stringify(v ?? null);
  let s = cache.get(v);
  if (s === undefined) {
    s = JSON.stringify(v);
    cache.set(v, s);
  }
  return s;
};

/** A list of things with their own id (tasks, calendar items…). */
const keyed = <S, T>(
  name: string,
  get: (s: S) => readonly T[],
  put: (items: T[]) => Partial<S>,
  idOf: (t: T) => string,
  sort?: (a: T, b: T) => number,
): Collection<S> => ({
  name,
  read: (s) => new Map(get(s).map((t) => [idOf(t), json(t)])),
  apply: (s, changes) => {
    const out: T[] = [];
    const seen = new Set<string>();
    for (const t of get(s)) {
      const id = idOf(t);
      seen.add(id);
      if (!changes.has(id)) out.push(t);
      else if (changes.get(id) !== null) out.push(JSON.parse(changes.get(id)!) as T);
    }
    for (const [id, v] of changes) if (!seen.has(id) && v !== null) out.push(JSON.parse(v) as T);
    if (sort) out.sort(sort);
    return put(out);
  },
});

/** Single values kept as one document each (settings, check-in answers…). */
const singles = <S, K extends keyof S & string>(name: string, keys: readonly K[], merges: Partial<Record<K, Merge>> = {}): Collection<S> => ({
  name,
  read: (s) => new Map(keys.map((k) => [k, json(s[k])])),
  apply: (_s, changes) => {
    const out: Partial<S> = {};
    for (const [k, v] of changes) if (v !== null && keys.includes(k as K)) out[k as K] = JSON.parse(v) as S[K];
    return out;
  },
  merge: (l, r, id) => (merges[id as K] ?? ((_l: string, rr: string) => rr))(l, r, id),
});

/** Records where every key only ever gets added (rewards shown, check-in answers): keep both sides' keys. */
const unionKeys: Merge = (l, r) => JSON.stringify({ ...JSON.parse(l), ...JSON.parse(r) });

const byAt = (a: { at: string }, b: { at: string }) => a.at.localeCompare(b.at);

/**
 * The activity log only grows, so it's grouped one document per day (UTC, so
 * every device groups it the same way). A day written on two devices keeps
 * every event from both.
 */
const events: Collection<MiosData> = {
  name: "events",
  read: (s) => {
    const days = new Map<string, string[]>();
    for (const e of s.events) {
      const day = e.at.slice(0, 10);
      const list = days.get(day) ?? [];
      list.push(json(e));
      days.set(day, list);
    }
    return new Map([...days].map(([d, list]) => [d, `[${list.join(",")}]`]));
  },
  apply: (s, changes) => {
    const kept = s.events.filter((e) => !changes.has(e.at.slice(0, 10)));
    const added = [...changes.values()].flatMap((v) => (v === null ? [] : (JSON.parse(v) as MiosEvent[])));
    return { events: [...kept, ...added].sort(byAt) };
  },
  merge: (l, r) => {
    const all = new Map<string, MiosEvent>();
    for (const e of [...(JSON.parse(l) as MiosEvent[]), ...(JSON.parse(r) as MiosEvent[])]) all.set(JSON.stringify(e), e);
    return JSON.stringify([...all.values()].sort(byAt));
  },
};

export const MIOS_COLLECTIONS: readonly Collection<MiosData>[] = [
  keyed("tasks", (s) => s.tasks, (tasks) => ({ tasks }), (t) => t.id),
  events,
  keyed("archive", (s) => s.archive, (archive) => ({ archive }), (a) => a.task.id),
  keyed("repeats", (s) => s.repeats, (repeats) => ({ repeats }), (r) => r.id),
  keyed("resources", (s) => s.resourceEntries, (resourceEntries) => ({ resourceEntries }), (r) => r.id, byAt),
  keyed("wraps", (s) => s.wraps, (wraps) => ({ wraps }), (w) => w.key),
  keyed("calendarSources", (s) => s.calendarSources, (calendarSources) => ({ calendarSources }), (c) => c.id),
  keyed(
    "calendarEvents",
    (s) => s.calendarEvents,
    (calendarEvents) => ({ calendarEvents }),
    (e) => e.key,
    (a, b) => a.start.localeCompare(b.start),
  ),
  keyed("meds", (s) => s.meds, (meds) => ({ meds }), (m) => m.id),
  keyed("medLogs", (s) => s.medLogs, (medLogs) => ({ medLogs }), (l) => l.id, (a, b) => a.at.localeCompare(b.at)),
  singles<MiosData, "settings" | "startedAt" | "tolerances" | "celebrated" | "calendarDecisions" | "google">(
    "meta",
    ["settings", "startedAt", "tolerances", "celebrated", "calendarDecisions", "google"],
    { celebrated: unionKeys, calendarDecisions: unionKeys, tolerances: unionKeys },
  ),
];

/** The AI side: what the background review learned, and which pop-up questions were already asked. */
export interface AiData {
  log: AnalysisEntry[];
  popupHistory: Record<string, string[]>;
}

export const AI_COLLECTIONS: readonly Collection<AiData>[] = [
  keyed("aiLog", (s) => s.log, (log) => ({ log }), (e) => e.id, (a, b) => b.at.localeCompare(a.at)),
  singles<AiData, "popupHistory">("aiMeta", ["popupHistory"]),
];

/** Every synced collection name, for the security rules. */
export const SYNCED_COLLECTIONS = [...MIOS_COLLECTIONS, ...AI_COLLECTIONS].map((c) => c.name);
