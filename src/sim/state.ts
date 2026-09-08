/**
 * Der Weltzustand.
 *
 * WorldState enthaelt ausschliesslich serialisierbare Spieldaten. Der
 * Chunk-Cache und der RNG sitzen daneben in World: der Cache ist abgeleitet,
 * der RNG-Zustand wird beim Serialisieren mitgeschrieben.
 *
 * Regel fuer dieses ganze Verzeichnis: keine Browser-API, kein Math.random,
 * kein Date.now, keine Floats im Zustand. test/boundary.test.ts prueft das.
 */

import { ChunkStore, terrainAt } from './chunks';
import { CHUNK_BITS, NEIGHBORS, tileKey } from './coords';
import { Rng } from './rng';
import { Tile, isBuildable } from './terrain';
import {
  BUILDING_SPECS,
  GOOD_COUNT,
  Placement,
  type Building,
  type BuildingType,
  type Carrier,
} from './types';

export interface WorldState {
  seed: number;
  tick: number;
  nextId: number;
  /** Vom Spieler veraendertes Terrain. Ueberlagert den generierten Chunk. */
  terrainOverride: Map<string, Tile>;
  roads: Set<string>;
  buildings: Map<number, Building>;
  /** Tile-Key -> Gebaeude-Id. Reiner Index, aus buildings ableitbar. */
  buildingAt: Map<string, number>;
  carriers: Map<number, Carrier>;
}

export interface World {
  state: WorldState;
  chunks: ChunkStore;
  rng: Rng;
  /**
   * Seit dem letzten Auslesen veraenderte Tiles - fuer die Cache-Invalidierung
   * im Renderer. Bewusst NICHT Teil von WorldState: rein transient, geht weder
   * in den Spielstand noch in den Zustands-Hash ein und kann die Simulation
   * daher nicht beeinflussen.
   */
  dirty: Set<string>;
}

export function createWorld(seed: number): World {
  return {
    state: {
      seed: seed | 0,
      tick: 0,
      nextId: 1,
      terrainOverride: new Map(),
      roads: new Set(),
      buildings: new Map(),
      buildingAt: new Map(),
      carriers: new Map(),
    },
    chunks: new ChunkStore(seed | 0),
    rng: new Rng(seed | 0),
    dirty: new Set(),
  };
}

/** Terrain inklusive Spielerveraenderungen. */
export function getTile(world: World, x: number, y: number): Tile {
  const override = world.state.terrainOverride.get(tileKey(x, y));
  if (override !== undefined) return override;
  return terrainAt(world.chunks, x, y);
}

export function setTile(world: World, x: number, y: number, t: Tile): void {
  const key = tileKey(x, y);
  // Wenn der Delta wieder dem generierten Wert entspricht, lieber loeschen -
  // sonst waechst der Spielstand mit jeder Ruecknahme.
  if (terrainAt(world.chunks, x, y) === t) {
    world.state.terrainOverride.delete(key);
  } else {
    world.state.terrainOverride.set(key, t);
  }
  world.dirty.add(key);
}

export const hasRoad = (world: World, x: number, y: number): boolean =>
  world.state.roads.has(tileKey(x, y));

export const buildingIdAt = (
  world: World,
  x: number,
  y: number,
): number | undefined => world.state.buildingAt.get(tileKey(x, y));

export function buildingAtTile(
  world: World,
  x: number,
  y: number,
): Building | undefined {
  const id = buildingIdAt(world, x, y);
  return id === undefined ? undefined : world.state.buildings.get(id);
}

/** Traeger laufen auf Strassen und durch Gebaeudetiles. */
export function isWalkable(world: World, x: number, y: number): boolean {
  const key = tileKey(x, y);
  return world.state.roads.has(key) || world.state.buildingAt.has(key);
}

export function canPlaceOn(world: World, x: number, y: number): boolean {
  if (world.state.buildingAt.has(tileKey(x, y))) return false;
  return isBuildable(getTile(world, x, y));
}

/** Grenzt mindestens eine der vier Nachbarkacheln ans Wasser? */
export function touchesWater(world: World, x: number, y: number): boolean {
  for (const [dx, dy] of NEIGHBORS) {
    if (getTile(world, x + dx, y + dy) === Tile.Water) return true;
  }
  return false;
}

/**
 * Platzierungspruefung inklusive der bauartspezifischen Bedingung.
 * Einzige Stelle, die entscheidet, ob ein Gebaeude irgendwo stehen darf -
 * Command-Validierung und Bauvorschau im Client fragen beide hier.
 */
export function canPlaceBuilding(
  world: World,
  type: BuildingType,
  x: number,
  y: number,
): boolean {
  if (!canPlaceOn(world, x, y)) return false;
  const spec = BUILDING_SPECS[type];
  if (spec.placement === Placement.Coast && !touchesWater(world, x, y)) return false;
  return true;
}

export function makeBuilding(
  id: number,
  type: BuildingType,
  x: number,
  y: number,
): Building {
  return {
    id,
    type,
    x,
    y,
    progress: -1,
    input: new Array<number>(GOOD_COUNT).fill(0),
    output: new Array<number>(GOOD_COUNT).fill(0),
    reserved: new Array<number>(GOOD_COUNT).fill(0),
    incoming: new Array<number>(GOOD_COUNT).fill(0),
  };
}

/**
 * Warenbestand, aufgeschluesselt nach Aufenthaltsort - nur fuer die Anzeige.
 *
 * Die Trennung ist nicht kosmetisch: "Holz das ich besitze" ist mehrdeutig.
 * Was im Lager liegt, ist verfuegbar. Was im Saegewerk-Puffer steckt oder
 * gerade getragen wird, gehoert dir zwar auch, ist aber gebunden. Wer nur
 * die Lagerzahl sieht, haelt eine volle Kette faelschlich fuer leer.
 */
export interface StockSummary {
  /** In Lagern - frei verfuegbar. */
  stored: number[];
  /** In Produktionsgebaeuden (Ein- und Ausgangspuffer). */
  buffered: number[];
  /** Von Traegern unterwegs. */
  inTransit: number[];
  /** Summe der drei. */
  total: number[];
}

export function stockSummary(world: World): StockSummary {
  const stored = new Array<number>(GOOD_COUNT).fill(0);
  const buffered = new Array<number>(GOOD_COUNT).fill(0);
  const inTransit = new Array<number>(GOOD_COUNT).fill(0);

  for (const b of world.state.buildings.values()) {
    const into = BUILDING_SPECS[b.type].isSink ? stored : buffered;
    for (let g = 0; g < GOOD_COUNT; g++) into[g] += b.input[g] + b.output[g];
  }
  for (const c of world.state.carriers.values()) {
    if (c.carrying >= 0) inTransit[c.carrying]++;
  }

  const total = stored.map((n, g) => n + buffered[g] + inTransit[g]);
  return { stored, buffered, inTransit, total };
}

/** Summiert, was in allen Lagern liegt. */
export function totalStock(world: World): number[] {
  return stockSummary(world).stored;
}

/** Chunk-Koordinaten aller vom Delta betroffenen Chunks - fuer Cache-Invalidierung. */
export const chunkCoordsOf = (x: number, y: number): [number, number] => [
  x >> CHUNK_BITS,
  y >> CHUNK_BITS,
];
