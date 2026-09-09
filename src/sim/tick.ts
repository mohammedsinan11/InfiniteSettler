/**
 * Der Tick. Feste Rate, unabhaengig von der Bildwiederholrate.
 *
 * Das ist kein Detail, sondern Bedingung fuer Lockstep: wenn die
 * Simulation an die Framerate gekoppelt waere, bekaemen zwei Spieler mit
 * unterschiedlich schnellen Rechnern unterschiedliche Welten.
 */

import { applyCommand, type Command } from './commands';
import {
  assignJobs,
  assignShipJobs,
  stepCarriers,
  stepHouses,
  stepProduction,
  stepShips,
} from './economy';
import type { World } from './state';

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;

/** Ein Simulationsschritt. Die einzige Stelle, die den Zustand vorwaerts bewegt. */
export function step(world: World, commands: readonly Command[] = []): void {
  for (const cmd of commands) applyCommand(world, cmd);
  // Essen vor Produzieren: sonst arbeitet ein Haus, das in diesem Tick
  // seine letzte Mahlzeit verbraucht, noch eine Runde mit voller
  // Belegschaft weiter.
  stepHouses(world);
  stepProduction(world);
  assignJobs(world);
  stepCarriers(world);
  assignShipJobs(world);
  stepShips(world);
  world.state.tick++;
}

/** Fuehrt eine ganze Command-Historie aus. Basis des Determinismus-Tests. */
export function run(
  world: World,
  ticks: number,
  log: ReadonlyMap<number, readonly Command[]>,
): void {
  for (let i = 0; i < ticks; i++) {
    step(world, log.get(world.state.tick) ?? []);
  }
}
