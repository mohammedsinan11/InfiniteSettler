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
import { CHUNK_BITS, tileKey } from './coords';
import { Rng } from './rng';
import { Tile, isBuildable } from './terrain';
import {
  BUILDING_SPECS,
  GOOD_COUNT,
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

/** Summiert, was in allen Lagern liegt - nur fuer die Anzeige. */
export function totalStock(world: World): number[] {
  const total = new Array<number>(GOOD_COUNT).fill(0);
  for (const b of world.state.buildings.values()) {
    if (!BUILDING_SPECS[b.type].isSink) continue;
    for (let g = 0; g < GOOD_COUNT; g++) total[g] += b.input[g];
  }
  return total;
}

/** Chunk-Koordinaten aller vom Delta betroffenen Chunks - fuer Cache-Invalidierung. */
export const chunkCoordsOf = (x: number, y: number): [number, number] => [
  x >> CHUNK_BITS,
  y >> CHUNK_BITS,
];
