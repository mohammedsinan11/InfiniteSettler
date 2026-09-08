/**
 * Vorstufen und Ausbau.
 *
 * Hintergrund ist eine Sackgasse im fruehen Spiel: Stein ist die einzige
 * Ware ohne Nachschub, aus dem Startvorrat lassen sich nur wenige Lager
 * bauen, und ohne Umschlagplatz in der Naehe ist ein entfernter
 * Steinbruch nicht zu betreiben. Wer den Startstein ausgegeben hatte, kam
 * an keinen neuen Stein mehr.
 *
 * Der Ausweg sind Vorstufen, die nur Holz kosten und sich spaeter
 * ausbauen lassen. Die Regel dahinter steht als eigener Test unten:
 * nichts, was zur Erschliessung einer Ware noetig ist, darf diese Ware
 * kosten.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, canUpgrade } from '../src/sim/commands';
import { createWorld, setTile, type World } from '../src/sim/state';
import { Tile } from '../src/sim/terrain';
import {
  BUILDING_SPECS,
  BuildingType,
  GOOD_COUNT,
  Good,
  type Building,
} from '../src/sim/types';

/** Ebenes Grasland mit einem See im Osten. */
function shore(): World {
  const world = createWorld(1234);
  for (let y = -20; y <= 20; y++) {
    for (let x = -20; x <= 20; x++) {
      setTile(world, x, y, x >= 10 ? Tile.Water : Tile.Grass);
    }
  }
  return world;
}

const at = (world: World, x: number, y: number): Building | undefined =>
  [...world.state.buildings.values()].find((b) => b.x === x && b.y === y);

/** Erstes Gebaeude ist geschenkt und gefuellt - der Startvorrat. */
function withStock(world: World): void {
  applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: -10, y: -10 });
}

const carriersOf = (world: World): number => world.state.carriers.size;

describe('Vorstufen und Ausbau', () => {
  it('die guenstigste Anlaufstelle kostet nur Holz', () => {
    // Der Kern der Regel: solange Holz nachwaechst, kommt man immer wieder
    // an einen Umschlagplatz - und damit an einen entfernten Steinbruch.
    const woodOnly = Object.values(BuildingType).filter((t) => {
      const spec = BUILDING_SPECS[t];
      if (!spec.isSink) return false;
      for (let g = 0; g < GOOD_COUNT; g++) {
        if (g !== Good.Wood && spec.cost[g] > 0) return false;
      }
      return true;
    });
    expect(woodOnly.length, 'mindestens eine Anlaufstelle ohne Stein').toBeGreaterThan(0);
  });

  it('der Steinbruch selbst kostet keinen Stein', () => {
    expect(BUILDING_SPECS[BuildingType.Quarry].cost[Good.Stone]).toBe(0);
  });

  it('baut an Ort und Stelle aus und behaelt Bestand und Id', () => {
    const world = shore();
    withStock(world);
    applyCommand(world, { t: 'build', bt: BuildingType.Depot, x: 0, y: 0 });

    const depot = at(world, 0, 0);
    expect(depot?.type).toBe(BuildingType.Depot);
    // Etwas einlagern, um zu sehen, dass der Ausbau nichts vernichtet.
    depot!.input[Good.Fish] = 7;
    const id = depot!.id;

    expect(applyCommand(world, { t: 'upgrade', x: 0, y: 0 })).toBe(true);

    const after = at(world, 0, 0);
    expect(after?.type).toBe(BuildingType.Storehouse);
    expect(after?.id, 'dieselbe Id, kein Neubau').toBe(id);
    expect(after?.input[Good.Fish], 'Bestand bleibt').toBe(7);
  });

  it('setzt beim Ausbau nur die fehlenden Traeger ein', () => {
    const world = shore();
    withStock(world);
    const before = carriersOf(world);
    applyCommand(world, { t: 'build', bt: BuildingType.Depot, x: 0, y: 0 });
    expect(carriersOf(world) - before).toBe(BUILDING_SPECS[BuildingType.Depot].carriers);

    applyCommand(world, { t: 'upgrade', x: 0, y: 0 });
    expect(carriersOf(world) - before).toBe(BUILDING_SPECS[BuildingType.Storehouse].carriers);
  });

  it('bucht die Ausbaukosten ab und scheitert ohne Vorrat', () => {
    const world = shore();
    withStock(world);
    applyCommand(world, { t: 'build', bt: BuildingType.Depot, x: 0, y: 0 });

    const store = at(world, -10, -10) as Building;
    const cost = BUILDING_SPECS[BuildingType.Depot].upgradeCost;
    const stoneBefore = store.input[Good.Stone];
    applyCommand(world, { t: 'upgrade', x: 0, y: 0 });
    expect(store.input[Good.Stone]).toBe(stoneBefore - cost[Good.Stone]);

    // Zweiter Umschlagplatz, danach alles leerraeumen. Das Holz muss von
    // Hand nachgelegt werden: der Startvorrat traegt genau einen.
    store.input[Good.Wood] = 20;
    applyCommand(world, { t: 'build', bt: BuildingType.Depot, x: 4, y: 0 });
    for (const b of world.state.buildings.values()) b.input.fill(0);
    expect(canUpgrade(world, 4, 0)).toBe(false);
    expect(applyCommand(world, { t: 'upgrade', x: 4, y: 0 })).toBe(false);
    expect(at(world, 4, 0)?.type).toBe(BuildingType.Depot);
  });

  it('laesst nur ausbauen, was eine Ausbaustufe hat', () => {
    const world = shore();
    withStock(world);
    applyCommand(world, { t: 'build', bt: BuildingType.Woodcutter, x: 0, y: 0 });
    expect(canUpgrade(world, 0, 0)).toBe(false);
    expect(applyCommand(world, { t: 'upgrade', x: 0, y: 0 })).toBe(false);
    // Leere Kachel ebenfalls nicht.
    expect(applyCommand(world, { t: 'upgrade', x: 5, y: 5 })).toBe(false);
  });

  it('der kleine Hafen faehrt mit einem Schiff, der grosse mit zweien', () => {
    const world = shore();
    withStock(world);
    applyCommand(world, { t: 'build', bt: BuildingType.SmallHarbor, x: 8, y: 0 });
    const harbor = at(world, 8, 0) as Building;
    expect(harbor.type).toBe(BuildingType.SmallHarbor);
    expect(world.state.ships.size).toBe(1);

    applyCommand(world, { t: 'upgrade', x: 8, y: 0 });
    expect(at(world, 8, 0)?.type).toBe(BuildingType.Harbor);
    expect(world.state.ships.size).toBe(BUILDING_SPECS[BuildingType.Harbor].ships);
    // Auch das nachgesetzte Schiff gehoert zum Hafen - sonst raeumt der
    // Abriss es nicht mit weg.
    for (const sh of world.state.ships.values()) expect(sh.home).toBe(harbor.id);
  });

  it('der billige Umschlagplatz oeffnet kein Gratis-Lager', () => {
    // Die Rettungsregel schenkt ein Lager, wenn es gar keine Anlaufstelle
    // mehr gibt. Zaehlte dabei nur das Lager, koennte man sich ueber einen
    // Umschlagplatz fuer vier Holz ein volles Lager erschleichen.
    const world = shore();
    withStock(world);
    applyCommand(world, { t: 'build', bt: BuildingType.Depot, x: 0, y: 0 });
    // Das gefuellte Startlager weg - es bleibt der leere Umschlagplatz.
    applyCommand(world, { t: 'demolish', x: -10, y: -10 });
    expect(at(world, 0, 0), 'Umschlagplatz steht noch').toBeDefined();

    expect(
      applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 4, y: 0 }),
      'kein Rettungslager, solange es eine Anlaufstelle gibt',
    ).toBe(false);
  });

  it('die Grundflaeche aendert sich beim Ausbau nicht', () => {
    // doUpgrade verlaesst sich darauf: es prueft nicht neu, ob zusaetzlicher
    // Platz frei waere.
    for (const t of Object.values(BuildingType)) {
      const spec = BUILDING_SPECS[t];
      if (spec.upgradesTo === -1) continue;
      expect(BUILDING_SPECS[spec.upgradesTo].footprint).toBe(spec.footprint);
    }
  });
});
