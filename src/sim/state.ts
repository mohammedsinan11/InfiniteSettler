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
  RunPhase,
  type Building,
  type BuildingType,
  type Carrier,
  type Ship,
  type RunState,
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
  ships: Map<number, Ship>;
  /** Roguelike-Rahmen um die weiterhin deterministische Siedlungssimulation. */
  run: RunState;
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
      ships: new Map(),
      // Der Simulationskern startet weiterhin als Sandbox. Der Client ruft
      // fuer einen neuen Durchlauf beginExpedition auf; dadurch bleiben Tests
      // und alte Werkzeuge kompatibel.
      run: {
        phase: RunPhase.Settled,
        expedition: null,
        scout: null,
        explored: new Set(),
        fogEnabled: false,
        landing: null,
        sites: [],
        wanderers: [],
      },
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

/**
 * Befahrbar fuer Schiffe.
 *
 * Reines Wasser - Fluesse eingeschlossen, denn die sind im Terrain
 * ebenfalls Wasser. Damit kann ein Schiff einen Fluss hinauffahren, wenn
 * er breit genug ist.
 */
export const isSailable = (world: World, x: number, y: number): boolean =>
  getTile(world, x, y) === Tile.Water;

export function canPlaceOn(world: World, x: number, y: number): boolean {
  if (world.state.buildingAt.has(tileKey(x, y))) return false;
  // Fraktionsorte und Ruinen sind dauerhafte Weltobjekte, keine Dekoration,
  // die von einem spaeter gesetzten Gebaeude verschluckt werden darf.
  if (world.state.run.sites.some((site) => site.x === x && site.y === y)) return false;
  return isBuildable(getTile(world, x, y));
}

/**
 * Sucht in der Naehe eine bessere Bauposition.
 *
 * "Besser" heisst: gueltig UND an eine Strasse oder ein Gebaeude
 * angrenzend - denn ohne Anschluss holt kein Traeger etwas ab, und ein
 * unangebundenes Gebaeude ist der haeufigste Anfaengerfehler. Gesucht wird
 * nur in einem kleinen Umkreis und nur, wenn die Zielposition selbst
 * keinen Anschluss hat; sonst wuerde die Vorschau unter dem Finger
 * wegspringen.
 *
 * Liefert die Ankerkachel oder null, wenn nichts Besseres in Reichweite ist.
 */
export function snapPlacement(
  world: World,
  type: BuildingType,
  x: number,
  y: number,
  radius = 3,
): { x: number; y: number } | null {
  if (canPlaceBuilding(world, type, x, y) && isConnected(world, type, x, y)) {
    return { x, y };
  }

  // Radius 3 statt 2: eine 3x3-Flaeche neben eine Strasse zu treffen
  // verlangt sonst mehr Zielgenauigkeit, als auf einem Handy zumutbar ist -
  // und der Zeiger steht beim Bauen oft genau AUF der Strasse, wo gar
  // nicht gebaut werden darf.
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!canPlaceBuilding(world, type, nx, ny)) continue;
      if (!isConnected(world, type, nx, ny)) continue;
      // Naeher schlaegt weiter; bei Gleichstand entscheidet die feste
      // Scanreihenfolge, damit die Vorschau nicht flackert.
      const score = dx * dx + dy * dy;
      if (score >= bestScore) continue;
      bestScore = score;
      best = { x: nx, y: ny };
    }
  }
  return best;
}

/** Grenzt die Grundflaeche an eine Strasse oder ein anderes Gebaeude? */
export function isConnected(
  world: World,
  type: BuildingType,
  x: number,
  y: number,
): boolean {
  let found = false;
  forEachFootprint(type, x, y, (tx, ty) => {
    for (const [dx, dy] of NEIGHBORS) {
      const key = tileKey(tx + dx, ty + dy);
      if (world.state.roads.has(key) || world.state.buildingAt.has(key)) found = true;
    }
  });
  return found;
}

/** Ruft fn fuer jede Kachel der Grundflaeche auf. */
export function forEachFootprint(
  type: BuildingType,
  x: number,
  y: number,
  fn: (tx: number, ty: number) => void,
): void {
  const n = BUILDING_SPECS[type].footprint;
  for (let dy = 0; dy < n; dy++) {
    for (let dx = 0; dx < n; dx++) fn(x + dx, y + dy);
  }
}

/** Grenzt eine Kachel der Grundflaeche ans Wasser? */
export function touchesWater(
  world: World,
  type: BuildingType,
  x: number,
  y: number,
): boolean {
  let found = false;
  forEachFootprint(type, x, y, (tx, ty) => {
    for (const [dx, dy] of NEIGHBORS) {
      if (getTile(world, tx + dx, ty + dy) === Tile.Water) found = true;
    }
  });
  return found;
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
  // JEDE Kachel der Grundflaeche muss frei und bebaubar sein - nicht nur
  // die Ankerkachel, sonst stuende das Gebaeude halb im Wasser.
  //
  // Strassen zaehlen dabei als belegt. Frueher wurden sie beim Bauen
  // stillschweigend ueberschrieben; damit riss man sich beim Setzen eines
  // Gebaeudes unbemerkt den eigenen Transportweg auf.
  let ok = true;
  forEachFootprint(type, x, y, (tx, ty) => {
    if (!canPlaceOn(world, tx, ty) || hasRoad(world, tx, ty)) ok = false;
  });
  if (!ok) return false;

  const spec = BUILDING_SPECS[type];
  if (spec.placement === Placement.Coast && !touchesWater(world, type, x, y)) {
    return false;
  }
  if (spec.placement === Placement.NearResource && !hasResourceNearby(world, type, x, y)) {
    return false;
  }
  return true;
}

/** Liegt die Rohstoffkachel der Bauart in Erntereichweite? */
export function hasResourceNearby(
  world: World,
  type: BuildingType,
  x: number,
  y: number,
): boolean {
  const spec = BUILDING_SPECS[type];
  if (spec.harvestTile < 0) return true;
  const r = spec.harvestRadius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      if (getTile(world, x + dx, y + dy) === spec.harvestTile) return true;
    }
  }
  return false;
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
