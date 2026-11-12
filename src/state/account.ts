"use client";

import { create } from "zustand";
import { watchAccount, type Account } from "@/integrations/firebase/auth";
import { firebaseConfigured } from "@/integrations/firebase/client";
import { hashOf, reconcile, type Base } from "@/integrations/firebase/reconcile";
import { listen, readAll, writeAll, type RemoteChange } from "@/integrations/firebase/remote";
import { useAi } from "./ai";
import { useMios, type MiosData } from "./store";
import { AI_COLLECTIONS, MIOS_COLLECTIONS, type AiData, type Collection } from "./syncCollections";

/**
 * Accounts and sync. Guests keep everything in this browser, as before.
 * Signed in (with a verified email), the data also lives in Firestore and
 * follows the person to every device. Signing out clears this browser.
 */

export type SyncPhase = "off" | "starting" | "choose" | "synced" | "saving" | "error";

interface AccountState {
  /** "loading" until Firebase says who's signed in. */
  status: "loading" | "guest" | "signed-in";
  account: Account | null;
  phase: SyncPhase;
  message?: string;
  /** First sign-in on a browser that already has data, when the account has data too. */
  choice?: { localTasks: number; remoteTasks: number };
  lastSyncedAt?: string;
}

export const useAccount = create<AccountState>()(() => ({ status: "loading", account: null, phase: "off" }));

const set = (patch: Partial<AccountState>) => useAccount.setState(patch);

// ---------------------------------------------------------------------------
// The sync base: what each item looked like at the last sync, per account
// ---------------------------------------------------------------------------

const BASE_KEY = "mios:sync:v1";

type BaseStore = { uid: string; base: Record<string, Record<string, string>> };

const loadBase = (uid: string): Map<string, Map<string, string>> | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(BASE_KEY) ?? "null") as BaseStore | null;
    if (!saved || saved.uid !== uid) return null;
    return new Map(Object.entries(saved.base).map(([name, ids]) => [name, new Map(Object.entries(ids))]));
  } catch {
    return null;
  }
};

const saveBase = (uid: string, base: Map<string, Map<string, string>>) => {
  const out: BaseStore = { uid, base: {} };
  for (const [name, ids] of base) out.base[name] = Object.fromEntries(ids);
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify(out));
  } catch {
    // Storage full or blocked: the next start reconciles from scratch, which is safe.
  }
};

// ---------------------------------------------------------------------------
// The two stores, seen the same way
// ---------------------------------------------------------------------------

interface Side<S> {
  collections: readonly Collection<S>[];
  get(): S;
  set(patch: Partial<S>): void;
  subscribe(fn: () => void): () => void;
}

const MIOS: Side<MiosData> = {
  collections: MIOS_COLLECTIONS,
  get: () => useMios.getState(),
  set: (patch) => useMios.setState(patch),
  subscribe: (fn) => useMios.subscribe(fn),
};

const AI: Side<AiData> = {
  collections: AI_COLLECTIONS,
  get: () => useAi.getState(),
  set: (patch) => useAi.setState(patch as Partial<ReturnType<typeof useAi.getState>>),
  subscribe: (fn) => useAi.subscribe(fn),
};

const SIDES = [MIOS, AI] as unknown as Side<unknown>[];

// ---------------------------------------------------------------------------
// The running session
// ---------------------------------------------------------------------------

interface Session {
  uid: string;
  base: Map<string, Map<string, string>>;
  stops: (() => void)[];
  timer?: ReturnType<typeof setTimeout>;
  flushing: boolean;
  again: boolean;
  stopped: boolean;
}

let session: Session | null = null;
let decide: ((keepLocal: boolean) => void) | null = null;

const SAVE_DELAY_MS = 800;

const baseOf = (s: Session, name: string) => {
  let b = s.base.get(name);
  if (!b) s.base.set(name, (b = new Map()));
  return b;
};

/** Send this browser's changes (since the last sync) to the account. */
const flush = async (s: Session): Promise<void> => {
  if (s.stopped) return;
  if (s.flushing) {
    s.again = true;
    return;
  }
  s.flushing = true;
  try {
    let wrote = false;
    for (const side of SIDES) {
      const state = side.get();
      for (const c of side.collections) {
        const local = c.read(state);
        const base = baseOf(s, c.name);
        const changes = new Map<string, string | null>();
        for (const [id, v] of local) if (base.get(id) !== hashOf(v)) changes.set(id, v);
        for (const id of base.keys()) if (!local.has(id)) changes.set(id, null);
        if (!changes.size) continue;
        if (!wrote) set({ phase: "saving" });
        wrote = true;
        await writeAll(s.uid, c.name, changes);
        if (s.stopped) return;
        for (const [id, v] of changes) {
          if (v === null) base.delete(id);
          else base.set(id, hashOf(v));
        }
      }
    }
    if (wrote) saveBase(s.uid, s.base);
    set({ phase: "synced", message: undefined, lastSyncedAt: new Date().toISOString() });
  } catch (e) {
    set({ phase: "error", message: syncMessage(e) });
  } finally {
    s.flushing = false;
    if (s.again && !s.stopped) {
      s.again = false;
      void flush(s);
    }
  }
};

const schedule = (s: Session) => {
  clearTimeout(s.timer);
  s.timer = setTimeout(() => void flush(s), SAVE_DELAY_MS);
};

/** Another device changed something: take it, unless this browser has an unsaved change to the same item. */
const onRemote = (s: Session, side: Side<unknown>, c: Collection<unknown>, changes: RemoteChange[]) => {
  if (s.stopped) return;
  const local = c.read(side.get());
  const base = baseOf(s, c.name);
  const toLocal = new Map<string, string | null>();
  let pending = false;
  for (const { id, v } of changes) {
    const l = local.get(id);
    const clean = l === undefined ? !base.has(id) || v === null : base.get(id) === hashOf(l);
    if (v === null) base.delete(id);
    else base.set(id, hashOf(v));
    if (clean) {
      if ((l ?? null) !== v) toLocal.set(id, v);
      continue;
    }
    // Changed here too, and not saved yet: settle it, and save the result.
    pending = true;
    if (l !== undefined && v !== null && c.merge) {
      const merged = c.merge(l, v, id);
      if (merged !== l) toLocal.set(id, merged);
    }
  }
  if (toLocal.size) side.set(c.apply(side.get(), toLocal));
  saveBase(s.uid, s.base);
  if (pending) schedule(s);
};

const counts = (data: MiosData) => data.tasks.length + data.archive.length;

/** Start syncing an account: reconcile with the account, then keep both in step. */
const start = async (uid: string): Promise<void> => {
  stop();
  const s: Session = { uid, base: new Map(), stops: [], flushing: false, again: false, stopped: false };
  session = s;
  set({ phase: "starting", message: undefined, choice: undefined });
  try {
    const remote = new Map<string, Map<string, string>>();
    for (const side of SIDES) for (const c of side.collections) remote.set(c.name, await readAll(uid, c.name));
    if (s.stopped) return;

    let base: Map<string, Map<string, string>> = loadBase(uid) ?? new Map();
    const firstTime = !loadBase(uid);
    const remoteTasks = (remote.get("tasks")?.size ?? 0) + (remote.get("archive")?.size ?? 0);
    const localTasks = counts(useMios.getState());
    if (firstTime && remoteTasks > 0 && localTasks > 0) {
      // This browser and the account both have tasks: ask before mixing them.
      set({ phase: "choose", choice: { localTasks, remoteTasks } });
      const keepLocal = await new Promise<boolean>((resolve) => (decide = resolve));
      decide = null;
      if (s.stopped) return;
      set({ phase: "starting", choice: undefined });
      if (!keepLocal) {
        // Treat this browser's data as already synced, so the account's copy replaces it.
        base = new Map();
        for (const side of SIDES) {
          for (const c of side.collections) base.set(c.name, new Map([...c.read(side.get())].map(([id, v]) => [id, hashOf(v)])));
        }
      }
    }

    for (const side of SIDES) {
      for (const c of side.collections) {
        const plan = reconcile(c.read(side.get()), remote.get(c.name) ?? new Map(), (base.get(c.name) ?? new Map()) as Base, c.merge);
        if (plan.toLocal.size) side.set(c.apply(side.get(), plan.toLocal));
        if (plan.toRemote.size) await writeAll(uid, c.name, plan.toRemote);
        if (s.stopped) return;
        s.base.set(c.name, plan.base);
      }
    }
    saveBase(uid, s.base);
    set({ phase: "synced", lastSyncedAt: new Date().toISOString() });

    for (const side of SIDES) {
      s.stops.push(side.subscribe(() => schedule(s)));
      for (const c of side.collections) {
        s.stops.push(
          listen(
            uid,
            c.name,
            (changes) => onRemote(s, side, c, changes),
            (e) => set({ phase: "error", message: syncMessage(e) }),
          ),
        );
      }
    }
    const onHide = () => document.visibilityState === "hidden" && void flush(s);
    document.addEventListener("visibilitychange", onHide);
    s.stops.push(() => document.removeEventListener("visibilitychange", onHide));
  } catch (e) {
    if (!s.stopped) set({ phase: "error", message: syncMessage(e) });
  }
};

const stop = () => {
  if (!session) return;
  session.stopped = true;
  clearTimeout(session.timer);
  session.stops.forEach((f) => f());
  session = null;
  decide?.(true);
};

/** Save anything waiting right now (before signing out). */
export const flushNow = async (): Promise<void> => {
  const s = session;
  if (!s || useAccount.getState().phase === "choose") return;
  clearTimeout(s.timer);
  await flush(s);
};

/** The answer to the first-sign-in question. */
export const chooseFirstSync = (keepLocal: boolean) => decide?.(keepLocal);

/** Try again after an error. */
export const retrySync = () => {
  const a = useAccount.getState().account;
  if (a?.verified) void start(a.uid);
};

/** Signing out: stop syncing and clear this browser, so the next person sees nothing. */
export const forgetLocalData = () => {
  stop();
  try {
    localStorage.removeItem(BASE_KEY);
  } catch {
    // ignore
  }
  useMios.getState().reset();
  useAi.getState().reset();
  set({ phase: "off", message: undefined, choice: undefined, lastSyncedAt: undefined });
};

const syncMessage = (e: unknown): string => {
  const code = (e as { code?: string })?.code ?? "";
  if (code === "permission-denied") return "Your account isn't allowed to sync yet. Verify your email, then try again.";
  if (code === "unavailable") return "No connection. Changes are saved here and sync when you're back online.";
  if (code === "resource-exhausted") return "The sync limit for today is used up. Changes are saved here and sync later.";
  return "Sync stopped. Your changes are saved in this browser.";
};

/** Mounted once in the app shell: follows sign-in and starts or stops sync. */
export const startAccountWatch = (): (() => void) => {
  if (!firebaseConfigured()) {
    set({ status: "guest", account: null });
    return () => {};
  }
  let uid: string | null = null;
  const unsub = watchAccount((account) => {
    set({ status: account ? "signed-in" : "guest", account });
    const next = account?.verified ? account.uid : null;
    if (next === uid) return;
    uid = next;
    if (next) void start(next);
    else stop();
  });
  return () => {
    unsub();
    stop();
  };
};

/** After verifying the email in another tab. */
export const accountRefreshed = (account: Account) => {
  set({ account });
  if (account.verified && session?.uid !== account.uid) void start(account.uid);
};
