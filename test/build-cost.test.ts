/**
 * Baukosten.
 *
 * Gebaeude entstehen sofort fertig; die Kosten werden im selben Moment aus
 * den Lagerbestaenden abgebucht. Reicht der Vorrat nicht, kommt der Bau
 * gar nicht erst zustande. Die Produktionskette behaelt damit ihren Zweck,
 * ohne dass man auf eine Anlieferung warten muss.
 */

import { describe, expect, it } from 'vitest';
import { applyCommand, canAfford } from '../src/sim/commands';
import { createWorld, setTile, totalStock, type World } from '../src/sim/state';
import { Tile } from '../src/sim/terrain';
import { step } from '../src/sim/tick';
import { BUILDING_SPECS, BuildingType, Good } from '../src/sim/types';

function flatWorld(): World {
  const world = createWorld(31337);
  for (let y = -10; y <= 12; y++) {
    for (let x = -4; x <= 30; x++) setTile(world, x, y, Tile.Grass);
  }
  for (let y = -5; y <= 5; y++) {
    for (let x = 16; x <= 28; x++) if (y < 0 || y > 2) setTile(world, x, y, Tile.Forest);
  }
  return world;
}

const at = (world: World, x: number, y: number) =>
  [...world.state.buildings.values()].find((b) => b.x === x && b.y === y);

describe('Baukosten', () => {
  it('macht den allerersten Bau geschenkt und gibt Startvorrat', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const home = at(world, 0, 0);
    // Ohne Startbestand waere das Spiel nicht startbar: jedes Gebaeude
    // kostet etwas, und die Kette muss irgendwo anfangen.
    expect(home?.input[Good.Plank]).toBeGreaterThan(0);
    expect(home?.input[Good.Stone]).toBeGreaterThan(0);
  });

  it('bucht die Kosten sofort ab und stellt das Gebaeude hin', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const vorher = totalStock(world)[Good.Plank];
    const kosten = BUILDING_SPECS[BuildingType.Quarry].cost[Good.Plank];

    const ok = applyCommand(world, { t: 'build', bt: BuildingType.Quarry, x: 6, y: 0 });

    expect(ok).toBe(true);
    expect(at(world, 6, 0), 'steht sofort').toBeDefined();
    expect(totalStock(world)[Good.Plank], 'sofort abgebucht').toBe(vorher - kosten);
  });

  it('verweigert den Bau, wenn der Vorrat nicht reicht', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const lager = at(world, 0, 0);
    if (lager) lager.input[Good.Plank] = 1; // weniger als jede Bauart kostet

    const ok = applyCommand(world, { t: 'build', bt: BuildingType.Quarry, x: 6, y: 0 });

    expect(ok).toBe(false);
    expect(at(world, 6, 0)).toBeUndefined();
    // Nichts angefasst - der Rest muss unveraendert liegenbleiben.
    expect(lager?.input[Good.Plank]).toBe(1);
  });

  it('bucht nichts ab, wenn nur EINE der Waren fehlt', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const lager = at(world, 0, 0);
    if (lager) lager.input[Good.Stone] = 0; // Lager braucht Bretter UND Stein
    const brettervorher = lager?.input[Good.Plank] ?? 0;

    const ok = applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 6, y: 0 });

    expect(ok).toBe(false);
    // Erst pruefen, dann abbuchen: sonst waeren die Bretter schon weg.
    expect(lager?.input[Good.Plank]).toBe(brettervorher);
  });

  it('gibt reservierte Ware nicht aus', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const lager = at(world, 0, 0);
    if (lager) {
      lager.input[Good.Plank] = 2;
      // Einem Traeger bereits zugesagt - diese Stuecke sind verplant.
      lager.reserved[Good.Plank] = 2;
    }
    expect(applyCommand(world, { t: 'build', bt: BuildingType.Quarry, x: 6, y: 0 })).toBe(false);
  });

  it('der Holzfaeller kostet nichts und geht immer', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const lager = at(world, 0, 0);
    if (lager) lager.input.fill(0);
    // Er ist der Einstieg: ohne ihn kaeme eine leergelaufene Siedlung nie
    // wieder an Holz und damit nie wieder an Bretter.
    expect(applyCommand(world, { t: 'build', bt: BuildingType.Woodcutter, x: 16, y: 0 })).toBe(true);
  });

  it('gibt ein kostenloses Lager, wenn keines mehr steht', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    applyCommand(world, { t: 'demolish', x: 0, y: 0 });
    const ok = applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 6, y: 0 });
    const rettung = at(world, 6, 0);
    expect(ok).toBe(true);
    // Aber leer, sonst liesse sich durch Abreissen und Neubauen Vorrat farmen.
    expect(rettung?.input[Good.Plank]).toBe(0);
  });

  it('ganze Kette laeuft und liefert Bretter', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Woodcutter, x: 16, y: 0 });
    applyCommand(world, { t: 'build', bt: BuildingType.Sawmill, x: 8, y: 0 });
    for (let x = 3; x <= 15; x++) {
      if (x >= 8 && x <= 10) continue;
      applyCommand(world, { t: 'road', x, y: 0 });
    }
    for (let i = 0; i < 4000; i++) step(world);

    expect(totalStock(world)[Good.Plank]).toBeGreaterThan(0);
    expect(world.state.terrainOverride.size, 'Wald wurde geschlagen').toBeGreaterThan(0);
  });
});

describe('Bezahlbarkeit', () => {
  it('erlaubt am Spielanfang JEDE Bauart', () => {
    const world = flatWorld();
    // Das Lager ist noch leer - aber der allererste Bau ist geschenkt.
    // Das Baumenue fragt canAfford; ohne die Ausnahme war dort alles
    // ausser dem kostenlosen Holzfaeller ausgegraut und man kam nicht ins
    // Spiel hinein.
    for (const t of Object.values(BuildingType)) {
      expect(canAfford(world, t), `Bauart ${t} am Anfang`).toBe(true);
    }
  });

  it('sperrt danach, was der Vorrat nicht hergibt', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const lager = [...world.state.buildings.values()][0];
    lager.input.fill(0);

    expect(canAfford(world, BuildingType.Woodcutter), 'kostenlos').toBe(true);
    expect(canAfford(world, BuildingType.Quarry), 'braucht Bretter').toBe(false);
    expect(canAfford(world, BuildingType.Sawmill), 'braucht Holz').toBe(false);
  });

  it('stimmt mit dem ueberein, was der Command tatsaechlich tut', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const lager = [...world.state.buildings.values()][0];
    lager.input.fill(0);
    lager.input[Good.Plank] = 2;

    // Anzeige und Wirkung duerfen nicht auseinanderlaufen: was das Menue
    // als baubar zeigt, muss der Command auch bauen.
    for (const t of [BuildingType.Quarry, BuildingType.Storehouse, BuildingType.Woodcutter]) {
      const gesagt = canAfford(world, t);
      const getan = applyCommand(world, { t: 'build', bt: t, x: 6, y: 6 });
      expect(getan, `Bauart ${t}`).toBe(gesagt);
      if (getan) applyCommand(world, { t: 'demolish', x: 6, y: 6 });
    }
  });

  it('gibt reservierte Ware auch in der Anzeige nicht frei', () => {
    const world = flatWorld();
    applyCommand(world, { t: 'build', bt: BuildingType.Storehouse, x: 0, y: 0 });
    const lager = [...world.state.buildings.values()][0];
    lager.input.fill(0);
    lager.input[Good.Plank] = 2;
    lager.reserved[Good.Plank] = 2;
    expect(canAfford(world, BuildingType.Quarry)).toBe(false);
  });
});

describe('Steinbruch', () => {
  it('baut Fels ab und verbraucht ihn dabei', () => {
    const world = createWorld(999);
    for (let y = -8; y <= 8; y++) {
      for (let x = -4; x <= 14; x++) setTile(world, x, y, Tile.Grass);
    }
    for (let y = -3; y <= 3; y++) {
      for (let x = 8; x <= 13; x++) setTile(world, x, y, Tile.Stone);
    }
    applyCommand(world, { t: 'build', bt: BuildingType.Quarry, x: 4, y: 0 });
    const quarry = at(world, 4, 0);
    expect(quarry, 'erster Bau ist geschenkt').toBeDefined();

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
