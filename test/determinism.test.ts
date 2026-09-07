/**
 * Der wichtigste Test des Projekts.
 *
 * Er kommt bewusst VOR dem Netzwerkcode: ein Desync-Bug ist in einer
 * kleinen, headless laufenden Simulation in Minuten zu finden - im
 * Zusammenspiel zweier Clients ueber ein Netzwerk in Tagen.
 */

import { describe, expect, it } from 'vitest';
import { deserialize, hashWorldHex, serialize } from '../src/sim/serialize';
import { step } from '../src/sim/tick';
import { totalStock } from '../src/sim/state';
import { BUILDING_SPECS, Good } from '../src/sim/types';
import type { World } from '../src/sim/state';
import type { Command } from '../src/sim/commands';
import { fixtureCommands, makeFixture } from './world-fixture';

const TICKS = 600;

function runCollectingHashes(
  world: World,
  ticks: number,
  log: Map<number, Command[]>,
  startTick = 0,
): string[] {
  const hashes: string[] = [];
  for (let i = startTick; i < ticks; i++) {
    step(world, log.get(world.state.tick) ?? []);
    hashes.push(hashWorldHex(world));
  }
  return hashes;
}

describe('determinismus', () => {
  it('liefert bei zwei Durchlaeufen dieselbe Hash-Folge', () => {
    const log = fixtureCommands();
    const a = runCollectingHashes(makeFixture(), TICKS, log);
    const b = runCollectingHashes(makeFixture(), TICKS, log);
    expect(a.length).toBe(TICKS);

    const firstDiff = a.findIndex((h, i) => h !== b[i]);
    expect(firstDiff, 'erster abweichender Tick').toBe(-1);
  });

  it('simuliert wirklich etwas - sonst waere der Test wertlos', () => {
    const world = makeFixture();
    runCollectingHashes(world, TICKS, fixtureCommands());

    const stock = totalStock(world);
    expect(stock[Good.Plank], 'Bretter im Lager').toBeGreaterThan(0);
    expect(world.state.carriers.size).toBeGreaterThan(0);

    // Der Holzfaeller muss Wald abgeholzt haben -> Terrain-Deltas entstanden.
    expect(world.state.terrainOverride.size).toBeGreaterThan(0);

    // Und mindestens ein Traeger war unterwegs.
    const busy = [...world.state.carriers.values()].some((c) => c.path.length > 0);
    expect(busy).toBe(true);
  });

  it('rechnet nach Speichern und Laden identisch weiter', () => {
    const log = fixtureCommands();
    const HALF = 250;

    const direct = makeFixture();
    runCollectingHashes(direct, HALF, log);
    const directRest = runCollectingHashes(direct, TICKS, log, HALF);

    const viaDisk = makeFixture();
    runCollectingHashes(viaDisk, HALF, log);
    // Bewusst durch JSON, damit auch Verluste beim Serialisieren auffallen.
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(viaDisk))));
    const revivedRest = runCollectingHashes(revived, TICKS, log, HALF);

    expect(revivedRest).toEqual(directRest);
  });

  it('haengt am Seed', () => {
    const log = fixtureCommands();
    const a = runCollectingHashes(makeFixture(1), 200, log);
    const b = runCollectingHashes(makeFixture(2), 200, log);
    expect(a[a.length - 1]).not.toBe(b[b.length - 1]);
  });

  it('serialisiert unabhaengig von der Einfuegereihenfolge', () => {
    // Zwei Welten mit denselben Strassen, aber in anderer Reihenfolge gesetzt,
    // muessen denselben Hash haben.
    const forward = makeFixture();
    const backward = makeFixture();
    for (let x = 1; x <= 10; x++) step(forward, [{ t: 'road', x, y: 3 }]);
    for (let x = 10; x >= 1; x--) step(backward, [{ t: 'road', x, y: 3 }]);
    expect(hashWorldHex(forward)).toBe(hashWorldHex(backward));
  });

  it('kennt fuer jeden Gebaeudetyp eine Spezifikation', () => {
    for (const spec of Object.values(BUILDING_SPECS)) {
      expect(typeof spec.name).toBe('string');
    }
  });
});
