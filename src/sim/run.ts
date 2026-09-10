/**
 * Roguelike-Rahmen: Seereise, Erkundung und Wahl des Siedlungsortes.
 *
 * Das Gruenderschiff ist absichtlich kein Ship aus economy.ts. Es nimmt
 * keine Handelsauftraege an, verbraucht keine Entity-ID und veraendert damit
 * weder die Startkostenlogik noch alte deterministische Command-Logs.
 */

import { NEIGHBORS, tileKey } from './coords';
import { FP_ONE, isqrt } from './fixed';
import { ensureLivingWorld, stepLivingWorld } from './living-world';
import { findPath } from './pathfind';
import { getTile, isSailable, type World } from './state';
import { generateTile, Tile } from './terrain';
import {
  BUILDING_SPECS,
  BuildingType,
  CARRIER_SPEED,
  RunPhase,
  SHIP_SPEED,
  type RunState,
  type Scout,
} from './types';

export const EXPEDITION_SUPPLIES = 72;
export const EXPEDITION_REVEAL_RADIUS = 9;
export const LANDING_DISTANCE = 5;
export const SCOUT_REVEAL_RADIUS = 7;

/**
 * Kleine, lesbare Freischaltfolge fuer neue Roguelike-Durchlaeufe.
 *
 * Alte Sandbox-Spielstaende erkennt man daran, dass sie weder Nebel noch
 * Gruenderschiff besitzen; fuer sie bleibt bewusst der volle Baukasten offen.
 * So aendert die neue Dramaturgie keinen bestehenden Spielstand.
 */
export function isBuildingUnlocked(world: World, type: BuildingType): boolean {
  const run = world.state.run;
  if (!run.fogEnabled && run.expedition === null) return true;
  if (run.phase === RunPhase.Voyage) return type === BuildingType.Storehouse;

  const has = (wanted: BuildingType): boolean => {
    for (const building of world.state.buildings.values()) {
      if (building.type === wanted) return true;
    }
    return false;
  };
  const hasWoodcutter = has(BuildingType.Woodcutter);
  const hasSawmill = has(BuildingType.Sawmill);

  switch (type) {
    case BuildingType.Storehouse:
    case BuildingType.Woodcutter:
      return true;
    case BuildingType.Sawmill:
    case BuildingType.Depot:
      return hasWoodcutter;
    case BuildingType.Quarry:
    case BuildingType.House:
    case BuildingType.FisherHut:
    case BuildingType.Farm:
    case BuildingType.SmallHarbor:
      return hasSawmill;
    case BuildingType.Mill:
      return has(BuildingType.Farm);
    case BuildingType.Bakery:
      return has(BuildingType.Mill);
    case BuildingType.Harbor:
      return has(BuildingType.SmallHarbor) || has(BuildingType.Harbor);
  }
}

/** Beginnt einen neuen Durchlauf an einer deterministisch gefundenen Kueste. */
export function beginExpedition(world: World): void {
  const [x, y] = findCoastalWater(world.state.seed);
  const run: RunState = {
    phase: RunPhase.Voyage,
    expedition: {
      x: (x * FP_ONE) | 0,
      y: (y * FP_ONE) | 0,
      heading: 2,
      path: [],
      pathIdx: 0,
      supplies: EXPEDITION_SUPPLIES,
      lastRevealX: x,
      lastRevealY: y,
    },
    scout: null,
    explored: new Set(),
    fogEnabled: true,
    landing: null,
    sites: [],
    wanderers: [],
  };
  revealAround(run, x, y, EXPEDITION_REVEAL_RADIUS);
  world.state.run = run;
}

/** Erteilt dem Gruenderschiff einen Seeweg. */
export function sailTo(world: World, x: number, y: number): boolean {
  const expedition = world.state.run.expedition;
  if (world.state.run.phase !== RunPhase.Voyage || !expedition) return false;
  if (expedition.supplies <= 0 || !isSailable(world, x, y)) return false;

  const sx = Math.round(expedition.x / FP_ONE);
  const sy = Math.round(expedition.y / FP_ONE);
  const path = findPath(world, sx, sy, x, y, isSailable);
  if (!path || path.length / 2 - 1 > expedition.supplies) return false;
  expedition.path = path;
  expedition.pathIdx = 0;
  return true;
}

/** Feste, deterministische Bewegung des Gruenderschiffs. */
export function stepRun(world: World): void {
  const run = world.state.run;
  const expedition = run.expedition;
  if (run.phase === RunPhase.Settled) {
    stepScout(world);
    stepLivingWorld(world);
    return;
  }
  if (!expedition) return;

  let budget = SHIP_SPEED;
  while (budget > 0 && expedition.pathIdx < expedition.path.length / 2) {
    const tx = expedition.path[expedition.pathIdx * 2] * FP_ONE;
    const ty = expedition.path[expedition.pathIdx * 2 + 1] * FP_ONE;
    const dx = tx - expedition.x;
    const dy = ty - expedition.y;
    const distance = isqrt(dx * dx + dy * dy);

    if (distance === 0) {
      expedition.pathIdx++;
      continue;
    }
    if (expedition.supplies <= 0) {
      expedition.path = [];
      expedition.pathIdx = 0;
      break;
    }
    expedition.heading = dx < 0 ? 3 : dx > 0 ? 1 : dy < 0 ? 0 : 2;
    if (distance <= budget) {
      expedition.x = tx | 0;
      expedition.y = ty | 0;
      budget -= distance;
      expedition.pathIdx++;
      expedition.supplies--;
    } else {
      // Seewege sind orthogonal; genau eine Achse ist ungleich null.
      if (dx !== 0) expedition.x = (expedition.x + (dx < 0 ? -budget : budget)) | 0;
      else expedition.y = (expedition.y + (dy < 0 ? -budget : budget)) | 0;
      budget = 0;
    }
  }
  if (expedition.pathIdx >= expedition.path.length / 2) {
    expedition.path = [];
    expedition.pathIdx = 0;
  }

  const rx = Math.round(expedition.x / FP_ONE);
  const ry = Math.round(expedition.y / FP_ONE);
  if (rx !== expedition.lastRevealX || ry !== expedition.lastRevealY) {
    expedition.lastRevealX = rx;
    expedition.lastRevealY = ry;
    revealAround(run, rx, ry, EXPEDITION_REVEAL_RADIUS);
  }
}

/** Darf dieser Baucommand in der aktuellen Run-Phase ausgefuehrt werden? */
export function canBuildInRun(
  world: World,
  type: BuildingType,
  x: number,
  y: number,
): boolean {
  const run = world.state.run;
  if (!isBuildingUnlocked(world, type)) return false;
  if (run.phase !== RunPhase.Voyage) {
    if (!run.fogEnabled) return true;
    const footprint = BUILDING_SPECS[type].footprint;
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        if (!run.explored.has(tileKey(x + dx, y + dy))) return false;
      }
    }
    return true;
  }
  if (type !== BuildingType.Storehouse) return false;
  const expedition = world.state.run.expedition;
  if (!expedition) return false;
  const sx = Math.round(expedition.x / FP_ONE);
  const sy = Math.round(expedition.y / FP_ONE);
  return Math.abs(sx - x) + Math.abs(sy - y) <= LANDING_DISTANCE + 1;
}

/** Beendet die Reise; der vorhandene Siedlungskern uebernimmt wieder. */
export function completeLanding(world: World, x: number, y: number): void {
  const run = world.state.run;
  run.phase = RunPhase.Settled;
  run.landing = { x, y };
  run.fogEnabled = true;
  if (run.expedition) {
    run.expedition.path = [];
    run.expedition.pathIdx = 0;
  }
  const [scoutX, scoutY] = findScoutStart(world, x, y);
  run.scout = {
    x: (scoutX * FP_ONE) | 0,
    y: (scoutY * FP_ONE) | 0,
    heading: 2,
    path: [],
    pathIdx: 0,
    exploredSteps: 0,
    lastRevealX: scoutX,
    lastRevealY: scoutY,
  };
  revealAround(run, x + 1, y + 1, EXPEDITION_REVEAL_RADIUS + 3);
  revealAround(run, scoutX, scoutY, SCOUT_REVEAL_RADIUS);
  ensureLivingWorld(world);
}

/** Erteilt dem ausgewaehlten Spaehtrupp einen Landweg. */
export function scoutTo(world: World, x: number, y: number): boolean {
  const run = world.state.run;
  const scout = run.scout;
  if (run.phase !== RunPhase.Settled || !run.fogEnabled || !scout) return false;
  if (!isScoutPassable(world, x, y)) return false;
  const sx = Math.round(scout.x / FP_ONE);
  const sy = Math.round(scout.y / FP_ONE);
  const path = findPath(world, sx, sy, x, y, isScoutPassable);
  if (!path) return false;
  scout.path = path;
  scout.pathIdx = 0;
  return true;
}

export function isExplored(world: World, x: number, y: number): boolean {
  return !world.state.run.fogEnabled || world.state.run.explored.has(tileKey(x, y));
}

export function expeditionNearLand(world: World): boolean {
  const expedition = world.state.run.expedition;
  if (!expedition) return false;
  const x = Math.round(expedition.x / FP_ONE);
  const y = Math.round(expedition.y / FP_ONE);
  for (let dy = -LANDING_DISTANCE; dy <= LANDING_DISTANCE; dy++) {
    for (let dx = -LANDING_DISTANCE; dx <= LANDING_DISTANCE; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > LANDING_DISTANCE) continue;
      if (getTile(world, x + dx, y + dy) !== Tile.Water) return true;
    }
  }
  return false;
}

function revealAround(run: RunState, x: number, y: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      run.explored.add(tileKey(x + dx, y + dy));
    }
  }
}

function stepScout(world: World): void {
  const run = world.state.run;
  const scout = run.scout;
  if (!run.fogEnabled || !scout) return;
  moveScout(scout);
  const rx = Math.round(scout.x / FP_ONE);
  const ry = Math.round(scout.y / FP_ONE);
  if (rx !== scout.lastRevealX || ry !== scout.lastRevealY) {
    scout.lastRevealX = rx;
    scout.lastRevealY = ry;
    revealAround(run, rx, ry, SCOUT_REVEAL_RADIUS);
  }
}

function moveScout(scout: Scout): void {
  let budget = CARRIER_SPEED;
  while (budget > 0 && scout.pathIdx < scout.path.length / 2) {
    const tx = scout.path[scout.pathIdx * 2] * FP_ONE;
    const ty = scout.path[scout.pathIdx * 2 + 1] * FP_ONE;
    const dx = tx - scout.x;
    const dy = ty - scout.y;
    const distance = isqrt(dx * dx + dy * dy);
    if (distance === 0) {
      scout.pathIdx++;
      continue;
    }
    scout.heading = dx < 0 ? 3 : dx > 0 ? 1 : dy < 0 ? 0 : 2;
    if (distance <= budget) {
      scout.x = tx | 0;
      scout.y = ty | 0;
      budget -= distance;
      scout.pathIdx++;
      scout.exploredSteps++;
    } else {
      if (dx !== 0) scout.x = (scout.x + (dx < 0 ? -budget : budget)) | 0;
      else scout.y = (scout.y + (dy < 0 ? -budget : budget)) | 0;
      budget = 0;
    }
  }
  if (scout.pathIdx >= scout.path.length / 2) {
    scout.path = [];
    scout.pathIdx = 0;
  }
}

const isScoutPassable = (world: World, x: number, y: number): boolean =>
  getTile(world, x, y) !== Tile.Water;

function findScoutStart(world: World, x: number, y: number): [number, number] {
  const candidates: Array<[number, number]> = [
    [x, y + 2], [x + 1, y + 2], [x + 2, y + 1], [x + 2, y],
    [x, y - 1], [x + 1, y - 1], [x - 1, y], [x - 1, y + 1],
  ];
  for (const [tx, ty] of candidates) {
    if (isScoutPassable(world, tx, ty) && !world.state.buildingAt.has(tileKey(tx, ty))) {
      return [tx, ty];
    }
  }
  return [x, y];
}

/** Findet Sand mit direktem Wasseranschluss, ringweise um den Ursprung. */
function findCoastalWater(seed: number): [number, number] {
  const inspect = (x: number, y: number): [number, number] | null => {
    if (generateTile(seed, x, y) !== Tile.Sand) return null;
    for (const [dx, dy] of NEIGHBORS) {
      const wx = x + dx;
      const wy = y + dy;
      if (generateTile(seed, wx, wy) === Tile.Water && hasOpenWater(seed, wx, wy)) {
        return [wx, wy];
      }
    }
    return null;
  };

  const origin = inspect(0, 0);
  if (origin) return origin;
  for (let r = 2; r <= 600; r += 2) {
    for (let i = -r; i <= r; i += 2) {
      for (const [x, y] of [[i, -r], [r, i], [i, r], [-r, i]] as const) {
        const found = inspect(x, y);
        if (found) return found;
      }
    }
  }

  // Extrem unwahrscheinliche Sicherheitsleine bei einer kuestenlosen Probe.
  for (let r = 1; r <= 800; r++) {
    if (generateTile(seed, r, 0) === Tile.Water) return [r, 0];
  }
  return [0, 0];
}

/** Verhindert Starts in winzigen Seen, aus denen die Expedition nie herauskommt. */
function hasOpenWater(seed: number, sx: number, sy: number): boolean {
  const queue: Array<[number, number]> = [[sx, sy]];
  const seen = new Set<string>([tileKey(sx, sy)]);
  for (let index = 0; index < queue.length && index < 700; index++) {
    const [x, y] = queue[index];
    if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) >= 12) return true;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const key = tileKey(nx, ny);
      if (seen.has(key) || generateTile(seed, nx, ny) !== Tile.Water) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return false;
}
