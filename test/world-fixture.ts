/**
 * Feste Testwelt.
 *
 * Das Terrain wird per Delta flachgelegt, statt sich auf die Noise-Werte an
 * einer bestimmten Stelle zu verlassen. Damit testet der Determinismus-Test
 * die Simulation und nicht das Terrain-Tuning - das haengt an noise.test.ts.
 *
 * Aufbau (y = 0):
 *   Lager(0,0) -- Strasse -- Saegewerk(6,0) -- Strasse -- Holzfaeller(12,0)
 * Rund um den Holzfaeller steht Wald.
 */

import type { Command } from '../src/sim/commands';
import { createWorld, setTile, type World } from '../src/sim/state';
import { Tile } from '../src/sim/terrain';
import { BuildingType } from '../src/sim/types';

export function makeFixture(seed = 12345): World {
  const world = createWorld(seed);

  for (let y = -8; y <= 8; y++) {
    for (let x = -2; x <= 18; x++) setTile(world, x, y, Tile.Grass);
  }
  // Wald in Reichweite des Holzfaellers, aber nicht auf der Strassenreihe.
  for (let y = -5; y <= 5; y++) {
    for (let x = 8; x <= 17; x++) {
      if (y !== 0) setTile(world, x, y, Tile.Forest);
    }
  }

  return world;
}

export function fixtureCommands(): Map<number, Command[]> {
  const log = new Map<number, Command[]>();

  const setup: Command[] = [
    { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 },
    { t: 'build', bt: BuildingType.Sawmill, x: 6, y: 0 },
    { t: 'build', bt: BuildingType.Woodcutter, x: 12, y: 0 },
  ];
  for (let x = 1; x <= 11; x++) {
    if (x === 6) continue;
    setup.push({ t: 'road', x, y: 0 });
  }
  log.set(0, setup);

  // Spaetere Eingriffe, damit der Test auch Aenderungen im laufenden Betrieb abdeckt.
  log.set(120, [
    { t: 'road', x: 12, y: 1 },
    { t: 'build', bt: BuildingType.Woodcutter, x: 12, y: 2 },
    { t: 'road', x: 12, y: 2 },
  ]);
  log.set(300, [{ t: 'demolish', x: 12, y: 1 }]);
  log.set(340, [{ t: 'road', x: 12, y: 1 }]);

  return log;
}
