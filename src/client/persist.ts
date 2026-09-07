/**
 * Spielstand in IndexedDB.
 *
 * Liegt bewusst im Client: src/sim darf keine Browser-API sehen. Gespeichert
 * wird der Snapshot aus sim/serialize - also nur Deltas und Einheiten, nie
 * das generierte Terrain. Ein Spielstand bleibt damit klein, egal wie weit
 * der Spieler gescrollt hat.
 */

import type { Snapshot } from '../sim/serialize';

const DB_NAME = 'infinite-settler';
const DB_VERSION = 1;
const STORE = 'saves';
const SLOT = 'auto';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(snap: Snapshot): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snap, SLOT);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  const db = await openDb();
  const snap = await new Promise<Snapshot | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(SLOT);
    req.onsuccess = () => resolve((req.result as Snapshot | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return snap;
}

export async function clearSnapshot(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(SLOT);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
