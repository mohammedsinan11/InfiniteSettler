/**
 * Feste Testwelt.
 *
 * Die Abstaende beruecksichtigen, dass jedes Gebaeude 2x2 Kacheln belegt:
 * ein Gebaeude auf (x,y) liegt auf (x..x+1, y..y+1), die Strasse muss also
 * daneben verlaufen und nicht hindurch.
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
    for (let x = -2; x <= 26; x++) setTile(world, x, y, Tile.Grass);
  }
  // Wald in Reichweite des Holzfaellers, aber nicht auf Strasse oder Bauflaeche.
  for (let y = -5; y <= 5; y++) {
    for (let x = 14; x <= 24; x++) {
      if (y < 0 || y > 2) setTile(world, x, y, Tile.Forest);
    }
  }

  return world;
}

export function fixtureCommands(): Map<number, Command[]> {
  const log = new Map<number, Command[]>();

  // Lager(0,0) belegt 0..1, Saegewerk(8,0) belegt 8..9,
  // Holzfaeller(16,0) belegt 16..17.
  const setup: Command[] = [
    { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 },
    { t: 'build', bt: BuildingType.Sawmill, x: 8, y: 0 },
    { t: 'build', bt: BuildingType.Woodcutter, x: 16, y: 0 },
  ];
  for (let x = 2; x <= 15; x++) {
    if (x >= 8 && x <= 9) continue;
    setup.push({ t: 'road', x, y: 0 });
  }
  log.set(0, setup);

  // Spaetere Eingriffe, damit der Test auch Aenderungen im laufenden Betrieb abdeckt.
  log.set(120, [
    { t: 'road', x: 19, y: 3 },
    { t: 'build', bt: BuildingType.Woodcutter, x: 20, y: 4 },
  ]);
  log.set(300, [{ t: 'demolish', x: 19, y: 3 }]);
  log.set(340, [{ t: 'road', x: 19, y: 3 }]);

  return log;
}
