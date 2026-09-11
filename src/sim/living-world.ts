/**
 * Deterministische Landmarken und neutrale Bewohner eines Expeditionsruns.
 *
 * Die Weltobjekte sind Simulationszustand, keine zufaellige Renderdeko:
 * Speichern/Laden, Lockstep und spaetere Begegnungsentscheidungen sehen damit
 * auf jedem Client dieselben Orte und dieselben Bewegungen.
 */

import { NEIGHBORS, tileKey } from './coords';
import { FP_ONE, isqrt } from './fixed';
import { hash2i } from './hash';
import { findPath } from './pathfind';
import { getTile, type World } from './state';
import { Tile } from './terrain';
import {
  BUILDING_SPECS,
  Good,
  RunPhase,
  WandererKind,
  WorldSiteKind,
  type Wanderer,
  type WorldSite,
} from './types';

const SITE_RADIUS_MIN = 15;
const SITE_RADIUS_MAX = 44;
const WANDER_SPEED = 1 << 11;
const VISIT_RADIUS_SQ = 5;

/** Alte Expeditionsspielstaende erhalten die neue Welt beim ersten Tick. */
export function ensureLivingWorld(world: World): void {
  const run = world.state.run;
  if (!run.fogEnabled || run.phase !== RunPhase.Settled || !run.landing) return;

  if (run.sites.length === 0) seedSites(world);
  if (run.wanderers.length === 0 && run.sites.length > 0) seedWanderers(world);
  discoverLivingWorld(world);
}

export function stepLivingWorld(world: World): void {
  ensureLivingWorld(world);
  const run = world.state.run;
  if (!run.fogEnabled || run.phase !== RunPhase.Settled) return;
  for (const wanderer of run.wanderers) stepWanderer(world, wanderer);
  discoverLivingWorld(world);
}

export function worldSiteAt(world: World, x: number, y: number): WorldSite | undefined {
  return world.state.run.sites.find((site) => site.x === x && site.y === y);
}

export function wandererAt(world: World, x: number, y: number): Wanderer | undefined {
  let nearest: Wanderer | undefined;
  let nearestDistance = 3;
  for (const wanderer of world.state.run.wanderers) {
    const wx = Math.round(wanderer.x / FP_ONE);
    const wy = Math.round(wanderer.y / FP_ONE);
    const distance = Math.abs(wx - x) + Math.abs(wy - y);
    if (distance < nearestDistance) {
      nearest = wanderer;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Loest genau einen der drei Belohnungswege eines erreichten Weltorts aus. */
export function resolveEncounter(world: World, siteId: number, choice: number): boolean {
  if (choice < 0 || choice > 2 || choice !== (choice | 0)) return false;
  const site = world.state.run.sites.find((candidate) => candidate.id === siteId);
  if (!site || site.visitedTick < 0 || site.resolvedChoice >= 0) return false;

  if (choice === 0) grantSupplies(world, site.kind);
  else if (choice === 1) grantKnowledge(world, site);
  else grantLegacy(world, site.kind);

  site.resolvedChoice = choice;
  site.resolvedTick = Math.max(1, world.state.tick);
  discoverLivingWorld(world);
  return true;
}

function grantSupplies(world: World, kind: WorldSite['kind']): void {
  const storage = [...world.state.buildings.values()]
    .filter((building) => BUILDING_SPECS[building.type].isSink)
    .sort((a, b) => a.id - b.id)[0];
  if (!storage) return;
  if (kind === WorldSiteKind.Ruin) {
    storage.input[Good.Plank] += 4;
    storage.input[Good.Stone] += 3;
  } else if (kind === WorldSiteKind.Tidewatch) {
    storage.input[Good.Fish] += 6;
    storage.input[Good.Plank] += 2;
  } else {
    storage.input[Good.Wood] += 8;
  }
}

function grantKnowledge(world: World, source: WorldSite): void {
  let target: WorldSite | null = null;
  let bestDistance = Infinity;
  for (const site of world.state.run.sites) {
    if (site.id === source.id || site.discoveredTick >= 0) continue;
    const dx = site.x - source.x;
    const dy = site.y - source.y;
    const distance = dx * dx + dy * dy;
    if (distance >= bestDistance) continue;
    target = site;
    bestDistance = distance;
  }
  if (!target) {
    world.state.run.bonuses.scoutVision++;
    return;
  }
  revealCircle(world, target.x, target.y, 6);
}

function grantLegacy(world: World, kind: WorldSite['kind']): void {
  if (kind === WorldSiteKind.Ruin) world.state.run.bonuses.scoutVision += 2;
  else if (kind === WorldSiteKind.Tidewatch) world.state.run.bonuses.scoutSpeed++;
  else world.state.run.bonuses.woodYield++;
}

function revealCircle(world: World, x: number, y: number, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      world.state.run.explored.add(tileKey(x + dx, y + dy));
    }
  }
}

function seedSites(world: World): void {
  const run = world.state.run;
  const landing = run.landing as { x: number; y: number };
  const originX = run.scout ? Math.round(run.scout.x / FP_ONE) : landing.x;
  const originY = run.scout ? Math.round(run.scout.y / FP_ONE) : landing.y;
  const reachable = collectReachableLand(world, originX, originY);
  const used: Array<{ x: number; y: number }> = [{ x: landing.x, y: landing.y }];

  const requests: Array<{
    kind: WorldSite['kind'];
    salt: number;
    accepts: (world: World, x: number, y: number) => boolean;
  }> = [
    { kind: WorldSiteKind.Tidewatch, salt: 0x13579, accepts: isCoastalLand },
    { kind: WorldSiteKind.GroveCircle, salt: 0x2468a, accepts: (w, x, y) => getTile(w, x, y) === Tile.Forest },
    { kind: WorldSiteKind.Ruin, salt: 0x3a551, accepts: isRuinGround },
    { kind: WorldSiteKind.Ruin, salt: 0x5c771, accepts: isRuinGround },
    { kind: WorldSiteKind.Ruin, salt: 0x7e993, accepts: isRuinGround },
  ];

  for (let id = 0; id < requests.length; id++) {
    const request = requests[id];
    const position = chooseSite(world, reachable, used, request.salt, request.accepts)
      ?? chooseSite(world, reachable, used, request.salt ^ 0x55aa, isLand);
    if (!position) continue;
    used.push(position);
    run.sites.push({
      id: id + 1,
      kind: request.kind,
      x: position.x,
      y: position.y,
      discoveredTick: -1,
      visitedTick: -1,
      resolvedChoice: -1,
      resolvedTick: -1,
    });
  }
}

function seedWanderers(world: World): void {
  const run = world.state.run;
  const grove = run.sites.find((site) => site.kind === WorldSiteKind.GroveCircle);
  const tidewatch = run.sites.find((site) => site.kind === WorldSiteKind.Tidewatch);
  const ruins = run.sites.filter((site) => site.kind === WorldSiteKind.Ruin);
  const homes: Array<{ kind: Wanderer['kind']; x: number; y: number }> = [];

  if (grove) {
    homes.push(
      { kind: WandererKind.Deer, x: grove.x, y: grove.y },
      { kind: WandererKind.Deer, x: grove.x + 3, y: grove.y - 2 },
    );
  }
  for (const ruin of ruins.slice(0, 2)) homes.push({ kind: WandererKind.Boar, x: ruin.x, y: ruin.y });
  if (tidewatch) homes.push({ kind: WandererKind.Wayfarer, x: tidewatch.x, y: tidewatch.y });
  if (grove) homes.push({ kind: WandererKind.Wayfarer, x: grove.x, y: grove.y });

  let id = 1;
  for (const home of homes) {
    const start = findNearbyLand(world, home.x, home.y, id * 0x91b3) ?? { x: home.x, y: home.y };
    const hash = hash2i(world.state.seed ^ 0x44d12, id, home.kind) >>> 0;
    run.wanderers.push({
      id,
      kind: home.kind,
      x: (start.x * FP_ONE) | 0,
      y: (start.y * FP_ONE) | 0,
      heading: (hash & 3) as 0 | 1 | 2 | 3,
      path: [],
      pathIdx: 0,
      homeX: home.x,
      homeY: home.y,
      nextDecisionTick: world.state.tick + 12 + (hash % 90),
    });
    id++;
  }
}

function discoverLivingWorld(world: World): void {
  const run = world.state.run;
  const scout = run.scout;
  const scoutX = scout ? Math.round(scout.x / FP_ONE) : 0;
  const scoutY = scout ? Math.round(scout.y / FP_ONE) : 0;
  for (const site of run.sites) {
    if (site.discoveredTick < 0 && run.explored.has(tileKey(site.x, site.y))) {
      site.discoveredTick = Math.max(1, world.state.tick);
    }
    if (site.discoveredTick >= 0 && site.visitedTick < 0 && scout) {
      const dx = site.x - scoutX;
      const dy = site.y - scoutY;
      if (dx * dx + dy * dy <= VISIT_RADIUS_SQ) {
        site.visitedTick = Math.max(1, world.state.tick);
      }
    }
  }
}

function stepWanderer(world: World, wanderer: Wanderer): void {
  if (wanderer.pathIdx >= wanderer.path.length / 2) {
    wanderer.path = [];
    wanderer.pathIdx = 0;
  }

  if (wanderer.path.length === 0 && world.state.tick >= wanderer.nextDecisionTick) {
    chooseWanderTarget(world, wanderer);
  }

  let budget = WANDER_SPEED;
  while (budget > 0 && wanderer.pathIdx < wanderer.path.length / 2) {
    const tx = wanderer.path[wanderer.pathIdx * 2] * FP_ONE;
    const ty = wanderer.path[wanderer.pathIdx * 2 + 1] * FP_ONE;
    const dx = tx - wanderer.x;
    const dy = ty - wanderer.y;
    const distance = isqrt(dx * dx + dy * dy);
    if (distance === 0) {
      wanderer.pathIdx++;
      continue;
    }
    wanderer.heading = dx < 0 ? 3 : dx > 0 ? 1 : dy < 0 ? 0 : 2;
    if (distance <= budget) {
      wanderer.x = tx | 0;
      wanderer.y = ty | 0;
      budget -= distance;
      wanderer.pathIdx++;
    } else {
      if (dx !== 0) wanderer.x = (wanderer.x + (dx < 0 ? -budget : budget)) | 0;
      else wanderer.y = (wanderer.y + (dy < 0 ? -budget : budget)) | 0;
      budget = 0;
    }
  }

  if (wanderer.path.length > 0 && wanderer.pathIdx >= wanderer.path.length / 2) {
    wanderer.path = [];
    wanderer.pathIdx = 0;
    const hash = hash2i(world.state.seed ^ 0x7721, wanderer.id, world.state.tick) >>> 0;
    wanderer.nextDecisionTick = world.state.tick + 45 + (hash % 110);
  }
}

function chooseWanderTarget(world: World, wanderer: Wanderer): void {
  const hash = hash2i(world.state.seed ^ 0x19ad3, wanderer.id, world.state.tick) >>> 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const h = hash2i(hash | 0, attempt, wanderer.id) >>> 0;
    const dx = ((h & 15) - 7) | 0;
    const dy = (((h >>> 4) & 15) - 7) | 0;
    const tx = wanderer.homeX + dx;
    const ty = wanderer.homeY + dy;
    if (!isWanderable(world, tx, ty)) continue;
    const sx = Math.round(wanderer.x / FP_ONE);
    const sy = Math.round(wanderer.y / FP_ONE);
    const path = findPath(world, sx, sy, tx, ty, isWanderable);
    if (!path) continue;
    wanderer.path = path;
    wanderer.pathIdx = 0;
    return;
  }
  wanderer.nextDecisionTick = world.state.tick + 80;
}

function collectReachableLand(world: World, sx: number, sy: number): Array<{ x: number; y: number }> {
  const queue: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];
  const seen = new Set<string>([tileKey(sx, sy)]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const [dx, dy] of NEIGHBORS) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (Math.abs(x - sx) > SITE_RADIUS_MAX || Math.abs(y - sy) > SITE_RADIUS_MAX) continue;
      const key = tileKey(x, y);
      if (seen.has(key) || !isLand(world, x, y)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return queue;
}

function chooseSite(
  world: World,
  candidates: Array<{ x: number; y: number }>,
  used: Array<{ x: number; y: number }>,
  salt: number,
  accepts: (world: World, x: number, y: number) => boolean,
): { x: number; y: number } | null {
  const landing = world.state.run.landing as { x: number; y: number };
  let best: { x: number; y: number } | null = null;
  let bestScore = 0xffffffff;
  for (const candidate of candidates) {
    const dx = candidate.x - landing.x;
    const dy = candidate.y - landing.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < SITE_RADIUS_MIN * SITE_RADIUS_MIN
      || distanceSq > SITE_RADIUS_MAX * SITE_RADIUS_MAX) continue;
    if (!accepts(world, candidate.x, candidate.y)) continue;
    if (used.some((site) => {
      const ux = site.x - candidate.x;
      const uy = site.y - candidate.y;
      return ux * ux + uy * uy < 64;
    })) continue;
    const score = hash2i(world.state.seed ^ salt, candidate.x, candidate.y) >>> 0;
    if (score >= bestScore) continue;
    best = candidate;
    bestScore = score;
  }
  return best;
}

function findNearbyLand(world: World, x: number, y: number, salt: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = 0xffffffff;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!isWanderable(world, tx, ty)) continue;
      const score = hash2i(world.state.seed ^ salt, tx, ty) >>> 0;
      if (score >= bestScore) continue;
      best = { x: tx, y: ty };
      bestScore = score;
    }
  }
  return best;
}

const isLand = (world: World, x: number, y: number): boolean => getTile(world, x, y) !== Tile.Water;

const isWanderable = (world: World, x: number, y: number): boolean =>
  isLand(world, x, y) && !world.state.buildingAt.has(tileKey(x, y));

const isRuinGround = (world: World, x: number, y: number): boolean => {
  const tile = getTile(world, x, y);
  return tile === Tile.Grass || tile === Tile.Stone || tile === Tile.Mountain;
};

function isCoastalLand(world: World, x: number, y: number): boolean {
  const tile = getTile(world, x, y);
  if (tile !== Tile.Sand && tile !== Tile.Grass) return false;
  for (const [dx, dy] of NEIGHBORS) if (getTile(world, x + dx, y + dy) === Tile.Water) return true;
  return false;
}
