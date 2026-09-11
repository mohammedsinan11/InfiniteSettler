import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { FP_ONE } from '../src/sim/fixed';
import { tileKey } from '../src/sim/coords';
import {
  beginExpedition,
  canBuildInRun,
  isExplored,
  isBuildingUnlocked,
  sailTo,
  scoutTo,
  stepRun,
} from '../src/sim/run';
import { deserialize, serialize } from '../src/sim/serialize';
import { step } from '../src/sim/tick';
import { canPlaceBuilding, createWorld, getTile } from '../src/sim/state';
import { Tile } from '../src/sim/terrain';
import { BuildingType, Good, RunPhase, WorldSiteKind } from '../src/sim/types';

describe('Expeditionsdurchlauf', () => {
  it('startet reproduzierbar auf Wasser und deckt nur die Umgebung auf', () => {
    const a = createWorld(4711);
    const b = createWorld(4711);
    beginExpedition(a);
    beginExpedition(b);

    expect(a.state.run.expedition).not.toBeNull();
    expect(a.state.run.expedition).toEqual(b.state.run.expedition);
    const ship = a.state.run.expedition!;
    const x = Math.round(ship.x / FP_ONE);
    const y = Math.round(ship.y / FP_ONE);
    expect(getTile(a, x, y)).toBe(Tile.Water);
    expect(isExplored(a, x, y)).toBe(true);
    expect(isExplored(a, x + 30, y + 30)).toBe(false);
  });

  it('bewegt das Gruenderschiff nur ueber Wasser und verbraucht Reisevorrat', () => {
    const world = createWorld(99);
    beginExpedition(world);
    const ship = world.state.run.expedition!;
    const sx = Math.round(ship.x / FP_ONE);
    const sy = Math.round(ship.y / FP_ONE);
    const target = adjacentWater(world, sx, sy);

    expect(sailTo(world, target.x, target.y)).toBe(true);
    for (let i = 0; i < 8; i++) stepRun(world);
    expect(Math.round(ship.x / FP_ONE)).toBe(target.x);
    expect(Math.round(ship.y / FP_ONE)).toBe(target.y);
    expect(ship.supplies).toBe(71);
  });

  it('laesst die Expedition nur mit einem nahen Lager anlanden', () => {
    const world = createWorld(31337);
    beginExpedition(world);
    const site = landingSite(world);

    expect(canBuildInRun(world, BuildingType.Woodcutter, site.x, site.y)).toBe(false);
    expect(applyCommand(world, {
      t: 'build', bt: BuildingType.Storehouse, x: site.x, y: site.y,
    })).toBe(true);
    expect(world.state.run.phase).toBe(RunPhase.Settled);
    expect(world.state.run.fogEnabled).toBe(true);
    expect(world.state.run.scout).not.toBeNull();
    const storehouse = [...world.state.buildings.values()][0];
    expect(storehouse.input[Good.Plank]).toBe(12);
    expect(storehouse.input[Good.Stone]).toBe(8);
  });

  it('laesst den Spaehtrupp Land aufdecken und bewahrt den Nebel', () => {
    const world = createWorld(31337);
    beginExpedition(world);
    const site = landingSite(world);
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: site.x, y: site.y });
    const scout = world.state.run.scout!;
    const before = world.state.run.explored.size;
    const target = reachableScoutTarget(world);

    expect(scoutTo(world, target.x, target.y)).toBe(true);
    for (let i = 0; i < 160; i++) stepRun(world);
    expect(scout.exploredSteps).toBeGreaterThanOrEqual(4);
    expect(world.state.run.explored.size).toBeGreaterThan(before);
    expect(world.state.run.fogEnabled).toBe(true);
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))));
    expect(loaded.state.run.scout).toEqual(scout);
  });

  it('speichert Reise, Nebel und Vorrat ohne Informationsverlust', () => {
    const world = createWorld(8080);
    beginExpedition(world);
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))));
    expect(loaded.state.run.phase).toBe(RunPhase.Voyage);
    expect(loaded.state.run.expedition).toEqual(world.state.run.expedition);
    expect(loaded.state.run.explored).toEqual(world.state.run.explored);
  });

  it('laedt alte Version-2-Siedlungen weiterhin vollstaendig aufgedeckt', () => {
    const snapshot = serialize(createWorld(123));
    delete snapshot.run;
    const loaded = deserialize(snapshot);
    expect(loaded.state.run.fogEnabled).toBe(false);
    expect(loaded.state.run.scout).toBeNull();
    expect(loaded.state.run.phase).toBe(RunPhase.Settled);
  });

  it('laedt den Expeditionsstand vor Einfuehrung der Spaeher', () => {
    const world = createWorld(456);
    beginExpedition(world);
    const snapshot = serialize(world);
    delete snapshot.run!.scout;
    const loaded = deserialize(snapshot);
    expect(loaded.state.run.scout).toBeNull();
    expect(loaded.state.run.fogEnabled).toBe(true);
    expect(loaded.state.run.phase).toBe(RunPhase.Voyage);
  });

  it('zeigt in neuen Durchlaeufen nur die naechsten sinnvollen Bauten', () => {
    const world = createWorld(31337);
    beginExpedition(world);
    expect(isBuildingUnlocked(world, BuildingType.Storehouse)).toBe(true);
    expect(isBuildingUnlocked(world, BuildingType.Woodcutter)).toBe(false);

    const site = landingSite(world);
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: site.x, y: site.y });
    expect(isBuildingUnlocked(world, BuildingType.Woodcutter)).toBe(true);
    expect(isBuildingUnlocked(world, BuildingType.Sawmill)).toBe(false);
    expect(isBuildingUnlocked(world, BuildingType.Bakery)).toBe(false);
  });

  it('setzt Fraktionsorte, Ruinen und neutrale Wanderer reproduzierbar', () => {
    const a = settledWorld(31337);
    const b = settledWorld(31337);

    expect(a.state.run.sites.length).toBeGreaterThanOrEqual(4);
    expect(a.state.run.sites).toEqual(b.state.run.sites);
    expect(a.state.run.wanderers.length).toBeGreaterThanOrEqual(4);
    expect(a.state.run.wanderers).toEqual(b.state.run.wanderers);
    expect(new Set(a.state.run.sites.map((site) => site.kind)).size).toBe(3);
  });

  it('findet die lebendige Welt auch fuer unterschiedliche Kartenformen', () => {
    for (const seed of [1, 7, 99, 456, 8080, 31337]) {
      const world = settledWorld(seed);
      expect(world.state.run.sites.length, `Seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(new Set(world.state.run.sites.map((site) => site.kind)).size, `Seed ${seed}`).toBe(3);
      expect(world.state.run.wanderers.length, `Seed ${seed}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('entdeckt Weltorte ueber den echten Erkundungsnebel', () => {
    const world = settledWorld(31337);
    const site = world.state.run.sites[0];
    expect(site.discoveredTick).toBe(-1);

    world.state.run.explored.add(tileKey(site.x, site.y));
    stepRun(world);
    expect(site.discoveredTick).toBeGreaterThanOrEqual(1);
  });

  it('bewegt neutrale Bewohner deterministisch und speichert sie verlustfrei', () => {
    const world = settledWorld(31337);
    const parallel = settledWorld(31337);
    const before = world.state.run.wanderers.map((wanderer) => [wanderer.x, wanderer.y]);
    for (let i = 0; i < 420; i++) {
      step(world);
      step(parallel);
    }
    const after = world.state.run.wanderers.map((wanderer) => [wanderer.x, wanderer.y]);
    expect(after).not.toEqual(before);
    expect(world.state.run.wanderers).toEqual(parallel.state.run.wanderers);

    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))));
    expect(loaded.state.run.sites).toEqual(world.state.run.sites);
    expect(loaded.state.run.wanderers).toEqual(world.state.run.wanderers);
  });

  it('ruestet bestehende Expeditionsspielstaende ohne Weltobjekte nach', () => {
    const world = settledWorld(31337);
    const snapshot = serialize(world);
    delete snapshot.run!.sites;
    delete snapshot.run!.wanderers;
    const loaded = deserialize(snapshot);
    expect(loaded.state.run.sites).toEqual([]);
    expect(loaded.state.run.wanderers).toEqual([]);

    stepRun(loaded);
    expect(loaded.state.run.sites.length).toBeGreaterThan(0);
    expect(loaded.state.run.wanderers.length).toBeGreaterThan(0);
  });

  it('loest eine erreichte Begegnung genau einmal mit drei Belohnungswegen', () => {
    const supplies = settledWorld(31337);
    const ruin = supplies.state.run.sites.find((site) => site.kind === WorldSiteKind.Ruin)!;
    ruin.discoveredTick = 1;
    ruin.visitedTick = 2;
    const storage = [...supplies.state.buildings.values()][0];
    const planks = storage.input[Good.Plank];
    expect(applyCommand(supplies, { t: 'encounter', siteId: ruin.id, choice: 0 })).toBe(true);
    expect(storage.input[Good.Plank]).toBe(planks + 4);
    expect(ruin.resolvedChoice).toBe(0);
    expect(applyCommand(supplies, { t: 'encounter', siteId: ruin.id, choice: 2 })).toBe(false);

    const knowledge = settledWorld(31337);
    const source = knowledge.state.run.sites[0];
    source.discoveredTick = 1;
    source.visitedTick = 2;
    const knownBefore = knowledge.state.run.sites.filter((site) => site.discoveredTick >= 0).length;
    expect(applyCommand(knowledge, { t: 'encounter', siteId: source.id, choice: 1 })).toBe(true);
    expect(knowledge.state.run.sites.filter((site) => site.discoveredTick >= 0).length).toBeGreaterThan(knownBefore);

    const legacy = settledWorld(31337);
    const grove = legacy.state.run.sites.find((site) => site.kind === WorldSiteKind.GroveCircle)!;
    grove.discoveredTick = 1;
    grove.visitedTick = 2;
    expect(applyCommand(legacy, { t: 'encounter', siteId: grove.id, choice: 2 })).toBe(true);
    expect(legacy.state.run.bonuses.woodYield).toBe(1);
  });

  it('ergaenzt alte Weltorte und Runs um Begegnungsfelder und Boni', () => {
    const snapshot = serialize(settledWorld(31337));
    delete snapshot.run!.bonuses;
    for (const site of snapshot.run!.sites!) {
      delete (site as Partial<typeof site>).resolvedChoice;
      delete (site as Partial<typeof site>).resolvedTick;
    }
    const loaded = deserialize(snapshot);
    expect(loaded.state.run.bonuses).toEqual({ scoutVision: 0, scoutSpeed: 0, woodYield: 0 });
    expect(loaded.state.run.sites.every((site) => site.resolvedChoice === -1 && site.resolvedTick === -1)).toBe(true);
  });

  it('laesst bestehende Sandbox-Spielstaende mit vollem Baukasten kompatibel', () => {
    const world = createWorld(7);
    for (const type of Object.values(BuildingType)) {
      expect(isBuildingUnlocked(world, type)).toBe(true);
    }
  });
});

function settledWorld(seed: number) {
  const world = createWorld(seed);
  beginExpedition(world);
  const site = landingSite(world);
  applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: site.x, y: site.y });
  return world;
}

function adjacentWater(world: ReturnType<typeof createWorld>, x: number, y: number) {
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    if (getTile(world, x + dx, y + dy) === Tile.Water) return { x: x + dx, y: y + dy };
  }
  throw new Error('Kein benachbartes Wasser am Expeditionsstart');
}

function landingSite(world: ReturnType<typeof createWorld>) {
  const ship = world.state.run.expedition!;
  const sx = Math.round(ship.x / FP_ONE);
  const sy = Math.round(ship.y / FP_ONE);
  for (let y = sy - 6; y <= sy + 6; y++) {
    for (let x = sx - 6; x <= sx + 6; x++) {
      if (canPlaceBuilding(world, BuildingType.Storehouse, x, y)
        && canBuildInRun(world, BuildingType.Storehouse, x, y)) return { x, y };
    }
  }
  throw new Error('Kein Lagerplatz am Expeditionsstart');
}

function reachableScoutTarget(world: ReturnType<typeof createWorld>) {
  const scout = world.state.run.scout!;
  const sx = Math.round(scout.x / FP_ONE);
  const sy = Math.round(scout.y / FP_ONE);
  for (let radius = 9; radius <= 16; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (getTile(world, x, y) === Tile.Water) continue;
        if (scoutTo(world, x, y)) return { x, y };
      }
    }
  }
  throw new Error('Kein erreichbares Späherziel');
}
