import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { docId, hashOf, idOfDoc, reconcile } from "@/integrations/firebase/reconcile";
import { useMios } from "../store";
import { MIOS_COLLECTIONS, SYNCED_COLLECTIONS } from "../syncCollections";

const items = (o: Record<string, string>) => new Map(Object.entries(o));
const base = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, hashOf(v)]));
const plain = (m: Map<string, string | null>) => Object.fromEntries(m);

describe("three-way sync", () => {
  it("first sync: everything new on either side goes to the other", () => {
    const p = reconcile(items({ a: "1" }), items({ b: "2" }), new Map());
    expect(plain(p.toLocal)).toEqual({ b: "2" });
    expect(plain(p.toRemote)).toEqual({ a: "1" });
    expect([...p.base.keys()].sort()).toEqual(["a", "b"]);
  });

  it("a change on one side goes to the other", () => {
    const b = base({ a: "1", c: "3" });
    const p = reconcile(items({ a: "1-edited", c: "3" }), items({ a: "1", c: "3-edited" }), b);
    expect(plain(p.toRemote)).toEqual({ a: "1-edited" });
    expect(plain(p.toLocal)).toEqual({ c: "3-edited" });
  });

  it("deletes travel too, but an edit beats a delete", () => {
    const b = base({ gone: "x", gone2: "y", kept: "z" });
    const p = reconcile(items({ gone2: "y", kept: "z2" }), items({ gone: "x", kept: "z" }), b);
    expect(plain(p.toRemote)).toEqual({ gone: null, kept: "z2" });
    expect(plain(p.toLocal)).toEqual({ gone2: null });

    // Deleted here, but edited on another device: the edit comes back.
    const q = reconcile(items({}), items({ a: "edited" }), base({ a: "old" }));
    expect(plain(q.toLocal)).toEqual({ a: "edited" });
    expect(q.toRemote.size).toBe(0);
  });

  it("changed on both: the merge decides, and both sides end up the same", () => {
    const p = reconcile(items({ a: "mine" }), items({ a: "theirs" }), base({ a: "old" }), (l, r) => `${l}+${r}`);
    expect(plain(p.toLocal)).toEqual({ a: "mine+theirs" });
    expect(plain(p.toRemote)).toEqual({ a: "mine+theirs" });
    // Without a merge, the account's copy wins.
    expect(plain(reconcile(items({ a: "mine" }), items({ a: "theirs" }), base({ a: "old" })).toLocal)).toEqual({ a: "theirs" });
  });

  it("running it again changes nothing", () => {
    const p = reconcile(items({ a: "1", b: "2" }), items({ b: "2", c: "3" }), new Map());
    const local = items({ a: "1", b: "2", c: "3" });
    const again = reconcile(local, local, p.base);
    expect(again.toLocal.size + again.toRemote.size).toBe(0);
  });

  it("any id can be a Firestore document id and back", () => {
    for (const id of ["a/b", ".", "..", "gym@life|2026-11-09T18:00:00.000Z", "google:primary", "100%"]) {
      expect(docId(id)).not.toMatch(/[/]|^\.{1,2}$/);
      expect(idOfDoc(docId(id))).toBe(id);
    }
  });
});

describe("what gets synced", () => {
  beforeEach(() => useMios.getState().reset());
  const col = (name: string) => MIOS_COLLECTIONS.find((c) => c.name === name)!;

  it("every saved field is covered by a collection", () => {
    const covered = new Set<string>();
    for (const c of MIOS_COLLECTIONS) for (const k of Object.keys(c.apply(useMios.getState(), new Map()))) covered.add(k);
    const s = useMios.getState();
    const meta = col("meta").read(s);
    for (const k of meta.keys()) covered.add(k);
    for (const [name, field] of [["tasks", "tasks"], ["events", "events"], ["archive", "archive"], ["repeats", "repeats"], ["resources", "resourceEntries"], ["wraps", "wraps"], ["calendarSources", "calendarSources"], ["calendarEvents", "calendarEvents"]] as const) {
      expect(Object.keys(col(name).apply(s, new Map()))).toEqual([field]);
      covered.add(field);
    }
    const saved = ["tasks", "events", "settings", "startedAt", "resourceEntries", "tolerances", "celebrated", "wraps", "calendarSources", "calendarEvents", "calendarDecisions", "google", "repeats", "archive"];
    expect(saved.filter((k) => !covered.has(k))).toEqual([]);
    expect(new Set(SYNCED_COLLECTIONS).size).toBe(SYNCED_COLLECTIONS.length);
  });

  it("the security rules allow exactly the synced collections", () => {
    const rules = readFileSync(join(process.cwd(), "firestore.rules"), "utf8");
    const list = /name in \[([^\]]+)\]/.exec(rules)![1];
    const names = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...SYNCED_COLLECTIONS].sort());
  });

  it("tasks round-trip: read, change, apply", () => {
    const st = () => useMios.getState();
    const a = st().addTask({ title: "A", mode: "chores", priority: 3 });
    st().addTask({ title: "B", mode: "chores", priority: 3 });
    const tasks = col("tasks");
    const read = tasks.read(st());
    expect([...read.keys()]).toHaveLength(2);
    const edited = JSON.stringify({ ...JSON.parse(read.get(a.id)!), title: "A2" });
    const patch = tasks.apply(st(), new Map<string, string | null>([[a.id, edited], ["new", JSON.stringify({ ...JSON.parse(edited), id: "new", title: "C" })]]));
    expect(patch.tasks!.map((t) => t.title)).toEqual(["A2", "B", "C"]);
    expect(tasks.apply(st(), new Map([[a.id, null]])).tasks!.map((t) => t.title)).toEqual(["B"]);
  });

  it("the activity log syncs one day per document, and a day saved on two devices keeps both", () => {
    const events = col("events");
    const e = (at: string, feature: string) => ({ type: "ai_used", at, stage: "child", feature });
    useMios.setState({ events: [e("2026-11-10T09:00:00.000Z", "B1"), e("2026-11-11T09:00:00.000Z", "B2")] as never });
    const read = events.read(useMios.getState());
    expect([...read.keys()]).toEqual(["2026-11-10", "2026-11-11"]);
    const here = JSON.stringify([e("2026-11-11T09:00:00.000Z", "B2"), e("2026-11-11T10:00:00.000Z", "B3")]);
    const there = JSON.stringify([e("2026-11-11T09:00:00.000Z", "B2"), e("2026-11-11T09:30:00.000Z", "B4")]);
    const merged = JSON.parse(events.merge!(here, there, "2026-11-11")) as { feature: string }[];
    expect(merged.map((x) => x.feature)).toEqual(["B2", "B4", "B3"]);
    const patch = events.apply(useMios.getState(), new Map([["2026-11-11", JSON.stringify(merged)]]));
    expect(patch.events!.map((x) => (x as { feature: string }).feature)).toEqual(["B1", "B2", "B4", "B3"]);
  });

  it("rewards shown and check-in answers keep both devices' entries; settings take the account's", () => {
    const meta = col("meta");
    const merge = (id: string, l: unknown, r: unknown) => JSON.parse(meta.merge!(JSON.stringify(l), JSON.stringify(r), id));
    expect(merge("celebrated", { a: "1" }, { b: "2" })).toEqual({ a: "1", b: "2" });
    expect(merge("settings", { stage: "child" }, { stage: "teen" })).toEqual({ stage: "teen" });
  });
});
