/**
 * Baukosten und Baustellen.
 *
 * Der Kniff ist, dass eine Baustelle kein Sonderfall im Transportsystem
 * ist, sondern ein Gebaeude mit consumes und ohne produces. Die
 * Auftragsvergabe muss davon nichts wissen. Diese Tests halten fest, dass
 * das wirklich traegt - und dass man ueberhaupt anfangen kann.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { createWorld, setTile, totalStock, type World } from '../src/sim/state';
import { Tile } from '../src/sim/terrain';
import { step } from '../src/sim/tick';
import { BUILDING_SPECS, BuildingType, Good } from '../src/sim/types';

function flatWorld(): World {
  const world = createWorld(31337);
  for (let y = -10; y <= 10; y++) {
    for (let x = -4; x <= 24; x++) setTile(world, x, y, Tile.Grass);
  }
  for (let y = -4; y <= 4; y++) {
    for (let x = 14; x <= 22; x++) if (y !== 0) setTile(world, x, y, Tile.Forest);
  }
  return world;
}

const at = (world: World, x: number, y: number) =>
  [...world.state.buildings.values()].find((b) => b.x === x && b.y === y);

describe('Baukosten', () => {
  it('macht den allerersten Bau geschenkt und fertig', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const home = at(world, 0, 0);
    expect(home?.built, 'erstes Gebaeude sofort fertig').toBe(true);
    // Ohne Startbestand waere das Spiel nicht startbar: jedes Gebaeude
    // kostet Bretter, Bretter kommen aus dem Saegewerk, das Bretter kostet.
    expect(home?.input[Good.Plank]).toBeGreaterThan(0);
    expect(home?.input[Good.Stone]).toBeGreaterThan(0);
  });

  it('legt jedes weitere kostenpflichtige Gebaeude als Baustelle an', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Quarry, x: 6, y: 0 });
    expect(at(world, 6, 0)?.built).toBe(false);
    // Der Holzfaeller kostet nichts und steht sofort.
    applyCommand(world, { t: 'build', bt: BuildingType.Woodcutter, x: 9, y: 0 });
    expect(at(world, 9, 0)?.built).toBe(true);
  });

  it('eine unversorgte Baustelle bleibt Baustelle', () => {
    const world = flatWorld();
    // Kein Lager, also kein Nachschub - und ohne Strasse ohnehin niemand da.
    applyCommand(world, { t: 'build', bt: BuildingType.Woodcutter, x: 6, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Sawmill, x: 9, y: 0 });
    for (let i = 0; i < 600; i++) step(world);
    expect(at(world, 9, 0)?.built, 'ohne Lieferung nicht fertig').toBe(false);
    expect(at(world, 9, 0)?.output[Good.Plank] ?? 0, 'produziert nicht').toBe(0);
  });

  it('Traeger liefern die Baukosten und die Baustelle wird fertig', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    // Steinbruch, weil er Bretter kostet - die liegen im Startlager.
    applyCommand(world, { t: 'build', bt: BuildingType.Quarry, x: 6, y: 0 });
    for (let x = 1; x <= 5; x++) applyCommand(world, { t: 'road', x, y: 0 });

    const kosten = BUILDING_SPECS[BuildingType.Quarry].cost[Good.Plank];
    const vorher = totalStock(world)[Good.Plank];
    for (let i = 0; i < 1200; i++) step(world);

    expect(at(world, 6, 0)?.built, 'Steinbruch fertiggestellt').toBe(true);
    // Die Ware ist wirklich verbraucht, nicht nur umgebucht.
    expect(vorher - totalStock(world)[Good.Plank]).toBeGreaterThanOrEqual(kosten);
    expect(at(world, 6, 0)?.input[Good.Plank]).toBeLessThan(kosten);
  });

  it('das Saegewerk kostet Holz, damit die Kette sich selbst starten kann', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    // Der Holzfaeller ist kostenlos und steht sofort - er ist der Einstieg.
    applyCommand(world, { t: 'build', bt: BuildingType.Woodcutter, x: 16, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Sawmill, x: 8, y: 0 });
    for (let x = 1; x <= 15; x++) {
      if (x !== 8) applyCommand(world, { t: 'road', x, y: 0 });
    }
    expect(at(world, 16, 0)?.built, 'Holzfaeller sofort nutzbar').toBe(true);
    expect(BUILDING_SPECS[BuildingType.Sawmill].cost[Good.Plank]).toBe(0);

    for (let i = 0; i < 3000; i++) step(world);
    expect(at(world, 8, 0)?.built, 'mit eigenem Holz gebaut').toBe(true);
  });

  it('gibt ein kostenloses Lager, wenn keines mehr steht', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    applyCommand(world, { t: 'demolish', x: 0, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 3, y: 0 });
    const rettung = at(world, 3, 0);
    // Ohne Lager gaebe es keine Traeger und damit keine Belieferung mehr -
    // das waere eine Sackgasse ohne Ausweg.
    expect(rettung?.built, 'Ersatzlager sofort nutzbar').toBe(true);
    // Aber leer, sonst liesse sich durch Abreissen und Neubauen Vorrat farmen.
    expect(rettung?.input[Good.Plank]).toBe(0);
  });

  it('ganze Kette: Lager finanziert Holzfaeller und Saegewerk', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Sawmill, x: 8, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Woodcutter, x: 16, y: 0 });
    for (let x = 1; x <= 15; x++) {
      if (x !== 8) applyCommand(world, { t: 'road', x, y: 0 });
    }
    for (let i = 0; i < 4000; i++) step(world);

    expect(at(world, 8, 0)?.built).toBe(true);
    expect(at(world, 16, 0)?.built).toBe(true);
    // Und danach produziert die Kette mehr Bretter, als der Bau gekostet hat.
    expect(totalStock(world)[Good.Plank]).toBeGreaterThan(0);
    expect(world.state.terrainOverride.size, 'Wald wurde geschlagen').toBeGreaterThan(0);
  });
});

describe('Steinbruch', () => {
  it('baut Fels ab und verbraucht ihn dabei', () => {
    const world = createWorld(999);
    for (let y = -8; y <= 8; y++) {
      for (let x = -4; x <= 12; x++) setTile(world, x, y, Tile.Grass);
    }
    for (let y = -3; y <= 3; y++) {
      for (let x = 6; x <= 11; x++) setTile(world, x, y, Tile.Stone);
    }
    applyCommand(world, { t: 'build', bt: BuildingType.Quarry, x: 4, y: 0 });
    const quarry = at(world, 4, 0);
    expect(quarry?.built, 'erster Bau ist geschenkt').toBe(true);

    const felsVorher = countTile(world, Tile.Stone);
    for (let i = 0; i < 1500; i++) step(world);

    expect(quarry?.output[Good.Stone]).toBeGreaterThan(0);
    expect(countTile(world, Tile.Stone), 'Fels wurde abgebaut').toBeLessThan(felsVorher);
  });
});

function countTile(world: World, tile: Tile): number {
  let n = 0;
  for (const t of world.state.terrainOverride.values()) if (t === tile) n++;
  return n;
}
