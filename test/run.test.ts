import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { FP_ONE } from '../src/sim/fixed';
import {
  beginExpedition,
  canBuildInRun,
  isExplored,
  sailTo,
  stepRun,
} from '../src/sim/run';
import { deserialize, serialize } from '../src/sim/serialize';
import { canPlaceBuilding, createWorld, getTile } from '../src/sim/state';
import { Tile } from '../src/sim/terrain';
import { BuildingType, Good, RunPhase } from '../src/sim/types';

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
    expect(world.state.run.fogEnabled).toBe(false);
    const storehouse = [...world.state.buildings.values()][0];
    expect(storehouse.input[Good.Plank]).toBe(12);
    expect(storehouse.input[Good.Stone]).toBe(8);
  });

  it('speichert Reise, Nebel und Vorrat ohne Informationsverlust', () => {
    const world = createWorld(8080);
    beginExpedition(world);
    const loaded = deserialize(JSON.parse(JSON.stringify(serialize(world))));
    expect(loaded.state.run.phase).toBe(RunPhase.Voyage);
    expect(loaded.state.run.expedition).toEqual(world.state.run.expedition);
    expect(loaded.state.run.explored).toEqual(world.state.run.explored);
  });
});

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
