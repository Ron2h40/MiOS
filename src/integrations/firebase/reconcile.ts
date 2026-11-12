/**
 * Three-way sync, pure. Every synced thing is an item with an id and a JSON
 * value. `base` holds a short hash of each item as it was at the last sync,
 * which tells "deleted here" from "new there" and "changed here" from
 * "changed there". Same idea as git's three-way merge, per item.
 */

/** id → JSON text. */
export type Items = ReadonlyMap<string, string>;
/** id → hash of the JSON text at the last sync. */
export type Base = ReadonlyMap<string, string>;

/** Short, stable fingerprint of a JSON text (FNV-1a plus length). */
export const hashOf = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${text.length.toString(36)}`;
};

/** How to settle an item changed on both sides. Returns the JSON to keep. */
export type Merge = (local: string, remote: string, id: string) => string;

/** Default: the account's copy wins, since another device saved it. */
export const remoteWins: Merge = (_local, remote) => remote;

export interface Plan {
  /** Changes for this browser: JSON to set, or null to delete. */
  toLocal: Map<string, string | null>;
  /** Changes for the account: JSON to set, or null to delete. */
  toRemote: Map<string, string | null>;
  /** The base after both sides are applied. */
  base: Map<string, string>;
}

export const reconcile = (local: Items, remote: Items, base: Base, merge: Merge = remoteWins): Plan => {
  const toLocal = new Map<string, string | null>();
  const toRemote = new Map<string, string | null>();
  const next = new Map<string, string>();
  const ids = new Set([...local.keys(), ...remote.keys(), ...base.keys()]);

  for (const id of ids) {
    const l = local.get(id);
    const r = remote.get(id);
    const b = base.get(id);
    const hl = l === undefined ? undefined : hashOf(l);
    const hr = r === undefined ? undefined : hashOf(r);

    let keep: string | undefined;
    if (l === undefined && r === undefined) {
      keep = undefined;
    } else if (l === undefined) {
      // Deleted here and unchanged there: delete there. Otherwise it's new or changed there: take it.
      if (b !== undefined && hr === b) toRemote.set(id, null);
      else keep = r;
    } else if (r === undefined) {
      // Deleted there and unchanged here: delete here. Otherwise it's new or changed here: send it.
      if (b !== undefined && hl === b) toLocal.set(id, null);
      else keep = l;
    } else if (hl === hr) {
      keep = l;
    } else if (hl === b) {
      keep = r; // only the account changed
    } else if (hr === b) {
      keep = l; // only this browser changed
    } else {
      keep = merge(l, r, id);
    }

    if (keep === undefined) continue;
    if (keep !== l) toLocal.set(id, keep);
    if (keep !== r) toRemote.set(id, keep);
    next.set(id, hashOf(keep));
  }
  return { toLocal, toRemote, base: next };
};

/**
 * Item ids become Firestore document ids. Those can't contain "/" or be "."
 * or "..", so ids are percent-encoded (dots too).
 */
export const docId = (id: string): string => encodeURIComponent(id).replace(/\./g, "%2E");
export const idOfDoc = (doc: string): string => decodeURIComponent(doc);
