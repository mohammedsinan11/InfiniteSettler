/**
 * Serialisierung des Weltzustands.
 *
 * Wird doppelt gebraucht: zum Speichern und als Grundlage des
 * Zustands-Hashes. Deshalb muss die Ausgabe bei gleichem Zustand
 * BYTEGLEICH sein - alle Sammlungen werden sortiert ausgegeben, nicht in
 * Einfuegereihenfolge. Sonst wuerden zwei identische Welten
 * unterschiedliche Hashes liefern.
 */

import { ChunkStore } from './chunks';
import { tileKey } from './coords';
import { fnv1a, hex8 } from './hash';
import { Rng } from './rng';
import type { World, WorldState } from './state';
import type { Tile } from './terrain';
import { GOOD_COUNT, type Building, type Carrier } from './types';

/**
 * Version 2: Die Terraingenerierung wurde ueberarbeitet (Domain Warping,
 * getrennte Kontinent- und Detailfelder, Grat-Gebirge). Dieselben
 * Koordinaten liefern damit anderes Terrain - ein alter Spielstand haette
 * Gebaeude im Wasser und Holzfaeller ohne Wald. Deshalb wird er verworfen
 * statt stillschweigend kaputt geladen.
 */
export const SNAPSHOT_VERSION = 2;

export interface Snapshot {
  v: number;
  seed: number;
  tick: number;
  nextId: number;
  rng: number;
  terrain: Array<[string, number]>;
  roads: string[];
  buildings: Building[];
  carriers: Carrier[];
}

const byId = (a: { id: number }, b: { id: number }): number => a.id - b.id;

export function serialize(world: World): Snapshot {
  const s = world.state;
  return {
    v: SNAPSHOT_VERSION,
    seed: s.seed,
    tick: s.tick,
    nextId: s.nextId,
    rng: world.rng.getState(),
    terrain: Array.from(s.terrainOverride.entries())
      .map(([k, t]) => [k, t as number] as [string, number])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    roads: Array.from(s.roads).sort(),
    buildings: Array.from(s.buildings.values())
      .map(cloneBuilding)
      .sort(byId),
    carriers: Array.from(s.carriers.values()).map(cloneCarrier).sort(byId),
  };
}

export function deserialize(snap: Snapshot): World {
  if (snap.v !== SNAPSHOT_VERSION) {
    throw new Error(
      'Spielstand hat Version ' + snap.v + ', erwartet wird ' + SNAPSHOT_VERSION,
    );
  }

  const state: WorldState = {
    seed: snap.seed | 0,
    tick: snap.tick | 0,
    nextId: snap.nextId | 0,
    terrainOverride: new Map(snap.terrain.map(([k, t]) => [k, t as Tile])),
    roads: new Set(snap.roads),
    buildings: new Map(),
    buildingAt: new Map(),
    carriers: new Map(),
  };

  for (const b of snap.buildings) {
    const copy = cloneBuilding(b);
    state.buildings.set(copy.id, copy);
    // buildingAt ist ein reiner Index und wird beim Laden neu aufgebaut,
    // statt ihn redundant mitzuspeichern.
    state.buildingAt.set(tileKey(copy.x, copy.y), copy.id);
  }
  for (const c of snap.carriers) {
    const copy = cloneCarrier(c);
    state.carriers.set(copy.id, copy);
  }

  const rng = new Rng(snap.seed | 0);
  rng.setState(snap.rng | 0);

  return { state, chunks: new ChunkStore(snap.seed | 0), rng, dirty: new Set() };
}

/**
 * Warenarrays auf die aktuelle Warenzahl bringen.
 *
 * Kommt eine Ware dazu (zuletzt Fisch mit dem Hafen), haben aeltere
 * Spielstaende zu kurze Arrays. Ohne Auffuellen liefe der Zugriff auf den
 * neuen Index auf undefined und die Bestaende wuerden zu NaN - ein Fehler,
 * der erst Minuten spaeter als "Traeger holen nichts mehr" auffiele.
 */
const goods = (values: number[] | undefined): number[] => {
  const out = new Array<number>(GOOD_COUNT).fill(0);
  if (values) for (let i = 0; i < Math.min(values.length, GOOD_COUNT); i++) out[i] = values[i];
  return out;
};

const cloneBuilding = (b: Building): Building => ({
  id: b.id,
  type: b.type,
  x: b.x,
  y: b.y,
  progress: b.progress,
  // Aeltere Spielstaende kennen das Feld nicht - dort war jedes Gebaeude
  // fertig, sonst haette es gar nicht existieren koennen.
  built: b.built ?? true,
  input: goods(b.input),
  output: goods(b.output),
  reserved: goods(b.reserved),
  incoming: goods(b.incoming),
});

const cloneCarrier = (c: Carrier): Carrier => ({
  id: c.id,
  x: c.x,
  y: c.y,
  path: c.path.slice(),
  pathIdx: c.pathIdx,
  state: c.state,
  carrying: c.carrying,
  jobGood: c.jobGood,
  jobFrom: c.jobFrom,
  jobTo: c.jobTo,
});

/** Fingerabdruck des Weltzustands. Zwei Clients mit gleichem Hash sind synchron. */
export function hashWorld(world: World): number {
  return fnv1a(JSON.stringify(serialize(world)));
}

export const hashWorldHex = (world: World): string => hex8(hashWorld(world));
