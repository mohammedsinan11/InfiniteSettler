/**
 * Seeverkehr.
 *
 * Schiffe gleichen Bestaende zwischen Haefen aus. Der Reiz daran ist,
 * dass keine Etappe etwas von der anderen wissen muss: Traeger bringen
 * Ware zum Hafen, Schiffe fahren sie zum naechsten, Traeger holen sie
 * dort ab. Jede Fahrt entscheidet sich allein aus zwei Lagerstaenden.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { dockTile } from '../src/sim/economy';
import { createWorld, setTile, type World } from '../src/sim/state';
import { Tile } from '../src/sim/terrain';
import { step } from '../src/sim/tick';
import { BUILDING_SPECS, BuildingType, CarrierState, Good } from '../src/sim/types';

/** Zwei Landzungen, dazwischen ein See. */
function twoShores(): World {
  const world = createWorld(4711);
  for (let y = -14; y <= 14; y++) {
    for (let x = -14; x <= 34; x++) {
      // Wasser als breiter Streifen in der Mitte.
      setTile(world, x, y, x >= 6 && x <= 15 ? Tile.Water : Tile.Grass);
    }
  }
  return world;
}

const at = (world: World, x: number, y: number) =>
  [...world.state.buildings.values()].find((b) => b.x === x && b.y === y);

/**
 * Ein Lager zuerst: der allererste Bau ist geschenkt und gefuellt, alles
 * danach kostet. Ohne diesen Vorrat kaeme der zweite Hafen nicht zustande.
 */
function withDepot(world: World): void {
  applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: -6, y: -6 });
}

describe('Haefen und Schiffe', () => {
  it('jeder Hafen bringt seine Schiffe mit, sie starten am Anleger', () => {
    const world = twoShores();
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 4, y: 0 });
    expect(world.state.ships.size).toBe(BUILDING_SPECS[BuildingType.Harbor].ships);

    const harbor = at(world, 4, 0);
    const dock = harbor ? dockTile(world, harbor) : null;
    const ship = [...world.state.ships.values()][0];
    expect(dock, 'Anleger gefunden').not.toBeNull();
    for (const sh of world.state.ships.values()) {
      expect([sh.x / 65536, sh.y / 65536]).toEqual([dock![0], dock![1]]);
    }
    expect(ship.home).toBe(harbor!.id);
  });

  it('reisst den Hafen ab, verschwindet sein Schiff mit', () => {
    const world = twoShores();
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 4, y: 0 });
    applyCommand(world, { t: 'demolish', x: 4, y: 0 });
    expect(world.state.ships.size).toBe(0);
  });

  it('faehrt Ware vom vollen zum leeren Hafen', () => {
    const world = twoShores();
    withDepot(world);
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 4, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 16, y: 0 });
    const west = at(world, 4, 0);
    const ost = at(world, 16, 0);
    expect(west && ost, 'beide Haefen stehen').toBeTruthy();

    west!.input[Good.Plank] = 9;
    const vorher = ost!.input[Good.Plank];
    for (let i = 0; i < 1500; i++) step(world);

    expect(ost!.input[Good.Plank], 'Ware kam drueben an').toBeGreaterThan(vorher);
    expect(west!.input[Good.Plank], 'und ging drueben ab').toBeLessThan(9);
  });

  it('faehrt nicht wegen eines einzigen Stuecks', () => {
    const world = twoShores();
    withDepot(world);
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 4, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 16, y: 0 });
    const west = at(world, 4, 0);
    west!.input.fill(0);
    at(world, 16, 0)!.input.fill(0);
    west!.input[Good.Plank] = 1;

    for (let i = 0; i < 300; i++) step(world);
    // Ohne Schwelle pendelten Schiffe endlos wegen einer einzigen Ware.
    const faehrt = [...world.state.ships.values()].some((s) => s.state !== CarrierState.Idle);
    expect(faehrt).toBe(false);
  });

  it('faehrt nicht ueber Land', () => {
    const world = createWorld(99);
    // Zwei Teiche ohne Verbindung.
    for (let y = -12; y <= 12; y++) {
      for (let x = -20; x <= 40; x++) setTile(world, x, y, Tile.Grass);
    }
    for (let y = -3; y <= 3; y++) {
      for (let x = 6; x <= 9; x++) setTile(world, x, y, Tile.Water);
      for (let x = 26; x <= 29; x++) setTile(world, x, y, Tile.Water);
    }
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: -10, y: -6 });
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 4, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Harbor, x: 24, y: 0 });
    at(world, 4, 0)!.input[Good.Plank] = 9;

    for (let i = 0; i < 800; i++) step(world);
    expect(at(world, 24, 0)!.input[Good.Plank], 'kein Landweg fuer Schiffe').toBe(0);
  });
});
