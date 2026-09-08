/**
 * Platzierungsregeln der Gebaeude.
 *
 * Der Hafen ist das erste Gebaeude mit einer Lagebindung. Die Regel liegt
 * bewusst in canPlaceBuilding und nicht im Client, damit Bauvorschau und
 * Command-Validierung nicht auseinanderlaufen koennen - ein Client, der
 * grosszuegiger prueft als die Simulation, wuerde unter Lockstep sofort
 * einen Desync erzeugen.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { canPlaceBuilding, createWorld, setTile, type World } from '../src/sim/state';
import { Tile } from '../src/sim/terrain';
import { BuildingType, Good } from '../src/sim/types';
import { step } from '../src/sim/tick';
import { totalStock } from '../src/sim/state';

/** Flache Graswelt mit einem See ab x >= 10. */
function coastWorld(): World {
  const world = createWorld(4242);
  for (let y = -12; y <= 12; y++) {
    for (let x = -12; x <= 20; x++) {
      setTile(world, x, y, x >= 10 ? Tile.Water : Tile.Grass);
    }
  }
  return world;
}

describe('Platzierung', () => {
  it('laesst Landgebaeude ueberall auf bebaubarem Grund zu', () => {
    const world = coastWorld();
    expect(canPlaceBuilding(world, BuildingType.Storehouse, 0, 0)).toBe(true);
    expect(canPlaceBuilding(world, BuildingType.Sawmill, 5, 3)).toBe(true);
  });

  it('verbietet jedes Gebaeude auf Wasser', () => {
    const world = coastWorld();
    expect(canPlaceBuilding(world, BuildingType.Storehouse, 12, 0)).toBe(false);
    expect(canPlaceBuilding(world, BuildingType.Harbor, 12, 0)).toBe(false);
  });

  it('laesst den Hafen nur mit angrenzendem Wasser zu', () => {
    const world = coastWorld();
    expect(canPlaceBuilding(world, BuildingType.Harbor, 9, 0)).toBe(true);
    expect(canPlaceBuilding(world, BuildingType.Harbor, 8, 0)).toBe(false);
    expect(canPlaceBuilding(world, BuildingType.Harbor, 0, 0)).toBe(false);
  });

  it('weist den Bau-Command an unzulaessiger Stelle zurueck', () => {
    const world = coastWorld();
    const ok = applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 9, y: 0 });
    const nope = applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 0, y: 5 });
    expect(ok).toBe(true);
    expect(nope).toBe(false);
    expect(world.state.buildings.size).toBe(1);
  });

  it('belegt keine Kachel doppelt', () => {
    const world = coastWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 9, y: 0 });
    expect(canPlaceBuilding(world, BuildingType.Storehouse, 9, 0)).toBe(false);
  });
});

describe('Hafen', () => {
  it('fischt, ohne das Wasser aufzubrauchen', () => {
    const world = coastWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 9, y: 0 });
    for (let x = 1; x <= 8; x++) applyCommand(world, { t: 'road', x, y: 0 });

    const waterBefore = countWater(world);
    for (let i = 0; i < 900; i++) step(world);

    expect(totalStock(world)[Good.Fish], 'Fisch im Lager').toBeGreaterThan(0);
    // Der Holzfaeller frisst seinen Wald auf, der Hafen darf das nicht.
    expect(countWater(world)).toBe(waterBefore);
  });

  it('versiegt nicht - anders als der Holzfaeller', () => {
    const world = coastWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 9, y: 0 });
    const harbor = [...world.state.buildings.values()][0];
    for (let i = 0; i < 2000; i++) step(world);
    // Ohne Abtransport laeuft der Puffer voll und bleibt voll.
    expect(harbor.output[Good.Fish]).toBeGreaterThan(0);
  });
});

function countWater(world: World): number {
  let n = 0;
  for (const tile of world.state.terrainOverride.values()) {
    if (tile === Tile.Water) n++;
  }
  return n;
}
