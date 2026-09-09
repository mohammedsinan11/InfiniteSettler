/**
 * Bevoelkerung und Nahrung.
 *
 * Das ist die Schleife, die das Spiel ueberhaupt zu einem Spiel macht:
 * Wohnhaeuser brauchen Nahrung, versorgte Haeuser stellen Siedler,
 * Siedler betreiben die Produktion, die Produktion erzeugt die Nahrung.
 * Faellt ein Glied aus, faellt die Kette in sich zusammen - und genau das
 * pruefen diese Tests.
 *
 * Die Einwohnerzahl ist bewusst ABGELEITET (ein Haus mit Nahrung oder einer
 * noch wirkenden Mahlzeit ist bewohnt) und kein eigenes Zustandsfeld. Sie
 * kann damit nicht vom uebrigen Zustand abweichen; die Tests halten diese
 * Eigenschaft fest.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { population, stepHouses } from '../src/sim/economy';
import { createWorld, setTile, type World } from '../src/sim/state';
import { Tile } from '../src/sim/terrain';
import { step } from '../src/sim/tick';
import {
  BASE_SETTLERS,
  BUILDING_SPECS,
  BuildingType,
  FOOD_TICKS,
  Good,
  type Building,
} from '../src/sim/types';

/** Grasland mit einem See ab x >= 12. */
function coast(): World {
  const world = createWorld(99);
  for (let y = -20; y <= 20; y++) {
    for (let x = -20; x <= 24; x++) {
      setTile(world, x, y, x >= 12 ? Tile.Water : Tile.Grass);
    }
  }
  return world;
}

const at = (world: World, x: number, y: number): Building =>
  [...world.state.buildings.values()].find((b) => b.x === x && b.y === y) as Building;

/** Erstes Gebaeude ist geschenkt und gefuellt. */
function withStock(world: World): void {
  applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: -10, y: -10 });
  for (const b of world.state.buildings.values()) b.input = [40, 40, 40, 40, 40, 40, 40];
}

describe('Bevoelkerung und Nahrung', () => {
  it('startet mit der Gruendergruppe, damit der Anfang keine Sackgasse ist', () => {
    // Ohne sie: Produktion braucht Siedler, Siedler brauchen ein Haus, ein
    // Haus braucht Bretter, Bretter kommen aus einer Produktion.
    const world = coast();
    expect(population(world)).toBe(BASE_SETTLERS);
    expect(BASE_SETTLERS).toBeGreaterThan(0);
  });

  it('ein versorgtes Haus bringt Siedler, ein leeres nicht', () => {
    const world = coast();
    withStock(world);
    applyCommand(world, { t: 'build', bt: BuildingType.House, x: 0, y: 0 });
    const house = at(world, 0, 0);

    expect(population(world), 'leeres Haus zaehlt nicht').toBe(BASE_SETTLERS);

    house.input[Good.Fish] = 1;
    expect(population(world)).toBe(BASE_SETTLERS + BUILDING_SPECS[BuildingType.House].settlers);

    house.input[Good.Fish] = 0;
    expect(population(world), 'ohne Nahrung steht das Haus leer').toBe(BASE_SETTLERS);
  });

  it('verbraucht eine Mahlzeit je Takt und zieht Brot dem Fisch vor', () => {
    const world = coast();
    withStock(world);
    applyCommand(world, { t: 'build', bt: BuildingType.House, x: 0, y: 0 });
    const house = at(world, 0, 0);
    house.input.fill(0);
    house.input[Good.Fish] = 1;
    house.input[Good.Bread] = 1;
    house.progress = 0;

    stepHouses(world);
    expect(house.input[Good.Bread], 'Brot zuerst').toBe(0);
    expect(house.input[Good.Fish], 'Fisch liegt noch da').toBe(1);
    expect(house.progress, 'Brot haelt laenger vor').toBe(FOOD_TICKS[Good.Bread]);
    expect(population(world), 'Bewohner bleiben waehrend die Mahlzeit wirkt').toBe(
      BASE_SETTLERS + BUILDING_SPECS[BuildingType.House].settlers,
    );

    // Nach Ablauf des Takts kommt der Fisch dran.
    house.progress = 0;
    stepHouses(world);
    expect(house.input[Good.Fish]).toBe(0);
    expect(house.progress).toBe(FOOD_TICKS[Good.Fish]);
    expect(population(world), 'auch die letzte verbrauchte Mahlzeit zaehlt weiter').toBe(
      BASE_SETTLERS + BUILDING_SPECS[BuildingType.House].settlers,
    );

    house.progress = 0;
    expect(population(world), 'erst nach Ablauf der Mahlzeit wird das Haus leer').toBe(
      BASE_SETTLERS,
    );
  });

  it('ohne Siedler steht die Produktion still', () => {
    // Der eigentliche Hebel: mehr Gebaeude als Siedler heisst, dass die
    // zuletzt gebauten nicht laufen.
    const world = coast();
    withStock(world);
    for (let i = 0; i < BASE_SETTLERS + 2; i++) {
      applyCommand(world, { t: 'build', bt: BuildingType.Farm, x: -8 + i * 3, y: 5 });
    }
    for (let i = 0; i < 200; i++) step(world);

    const farms = [...world.state.buildings.values()]
      .filter((b) => b.type === BuildingType.Farm)
      .sort((a, b) => a.id - b.id);
    expect(farms.length).toBe(BASE_SETTLERS + 2);
    // Die aeltesten arbeiten, die ueberzaehligen nicht.
    expect(farms[0].output[Good.Grain], 'aeltestes Feld laeuft').toBeGreaterThan(0);
    const idle = farms[farms.length - 1];
    expect(idle.output[Good.Grain], 'ueberzaehliges Feld steht').toBe(0);
    expect(idle.progress, 'und hat nicht einmal angefangen').toBe(-1);
  });

  it('ein Haus hebt die Grenze an, ein Abriss senkt sie wieder', () => {
    const world = coast();
    withStock(world);
    const spec = BUILDING_SPECS[BuildingType.House];
    applyCommand(world, { t: 'build', bt: BuildingType.House, x: 0, y: 0 });
    at(world, 0, 0).input[Good.Fish] = 2;
    expect(population(world)).toBe(BASE_SETTLERS + spec.settlers);

    applyCommand(world, { t: 'demolish', x: 0, y: 0 });
    expect(population(world)).toBe(BASE_SETTLERS);
  });

  it('die Nahrungskette laeuft vom Feld bis zum Brot durch', () => {
    const world = coast();
    withStock(world);
    // Lager, Feld, Muehle, Baeckerei an einer Strasse.
    applyCommand(world, { t: 'build', bt: BuildingType.Farm, x: 0, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Mill, x: 0, y: 4 });
    applyCommand(world, { t: 'build', bt: BuildingType.Bakery, x: 0, y: 8 });
    for (let y = -9; y <= 9; y++) applyCommand(world, { t: 'road', x: -9, y });
    for (let x = -9; x <= 1; x++) {
      applyCommand(world, { t: 'road', x, y: -9 });
      applyCommand(world, { t: 'road', x, y: 2 });
      applyCommand(world, { t: 'road', x, y: 6 });
      applyCommand(world, { t: 'road', x, y: 9 });
    }

    let bread = 0;
    for (let i = 0; i < 4000 && bread === 0; i++) {
      step(world);
      for (const b of world.state.buildings.values()) {
        bread = Math.max(bread, b.input[Good.Bread] + b.output[Good.Bread]);
      }
    }
    expect(bread, 'irgendwo ist Brot entstanden').toBeGreaterThan(0);
  });

  it('Haefen fischen nicht mehr - Nahrung kommt aus der Kette', () => {
    // Sonst waere der Umschlagplatz selbst eine Nahrungsquelle und die
    // ganze Kette ueberfluessig.
    for (const t of [BuildingType.Harbor, BuildingType.SmallHarbor]) {
      expect(BUILDING_SPECS[t].produces).toBe(-1);
    }
  });
});
