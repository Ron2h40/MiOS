"use client";

import {
  collection,
  doc,
  getDocsFromServer,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { firestore } from "./client";
import { docId, idOfDoc } from "./reconcile";

/**
 * Firestore reads and writes for sync. Data lives at
 * users/{uid}/{collection}/{item}, one document per item, each holding the
 * item as JSON text in `v` (and the server time of the write in `t`).
 */

const MAX_BATCH = 400; // Firestore allows 500 writes per batch; keep headroom.

const col = (uid: string, name: string) => collection(firestore(), "users", uid, name);

/** Everything in one collection, straight from the server. */
export const readAll = async (uid: string, name: string): Promise<Map<string, string>> => {
  const snap = await getDocsFromServer(col(uid, name));
  const out = new Map<string, string>();
  for (const d of snap.docs) {
    const v = d.get("v");
    if (typeof v === "string") out.set(idOfDoc(d.id), v);
  }
  return out;
};

/** Write a set of changes: JSON to save, or null to delete. Split into batches. */
export const writeAll = async (uid: string, name: string, changes: ReadonlyMap<string, string | null>): Promise<void> => {
  const entries = [...changes];
  for (let i = 0; i < entries.length; i += MAX_BATCH) {
    const batch = writeBatch(firestore());
    for (const [id, v] of entries.slice(i, i + MAX_BATCH)) {
      const ref = doc(col(uid, name), docId(id));
      if (v === null) batch.delete(ref);
      else batch.set(ref, { v, t: serverTimestamp() });
    }
    await batch.commit();
  }
};

export interface RemoteChange {
  id: string;
  /** New JSON, or null when the item was deleted. */
  v: string | null;
}

/**
 * Changes made elsewhere (another device), as they arrive. This browser's own
 * writes are skipped: they're already applied here.
 */
export const listen = (
  uid: string,
  name: string,
  onChanges: (changes: RemoteChange[]) => void,
  onError: (e: Error) => void,
): Unsubscribe =>
  onSnapshot(
    col(uid, name),
    (snap) => {
      // A document with pending writes is this browser's own change, not news.
      const changes = snap
        .docChanges()
        .filter((c) => !c.doc.metadata.hasPendingWrites)
        .map((c) => {
          const v = c.doc.get("v");
          return { id: idOfDoc(c.doc.id), v: c.type === "removed" || typeof v !== "string" ? null : v };
        });
      if (changes.length) onChanges(changes);
    },
    onError,
  );
