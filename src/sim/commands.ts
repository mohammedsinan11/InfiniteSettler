/**
 * Commands sind die EINZIGE Art, den Weltzustand zu veraendern.
 *
 * Das ist die Voraussetzung fuer Lockstep: ueber das Netz wandern spaeter
 * nur diese Objekte, jeder Client wendet dieselbe Liste in derselben
 * Reihenfolge an und kommt damit auf denselben Zustand. Direkte
 * Schreibzugriffe aus dem Client wuerden diese Kette sofort brechen.
 */

import { tileKey } from './coords';
import { FP_ONE } from './fixed';
import {
  buildingIdAt,
  canPlaceBuilding,
  makeBuilding,
  type World,
} from './state';
import { isBuildable } from './terrain';
import { getTile } from './state';
import {
  BuildingType,
  CarrierState,
  type Carrier,
} from './types';

export type Command =
  | { t: 'build'; bt: BuildingType; x: number; y: number }
  | { t: 'road'; x: number; y: number }
  | { t: 'demolish'; x: number; y: number };

/** Jedes neue Lager bringt eigene Traeger mit. */
const CARRIERS_PER_STOREHOUSE = 4;

/** Wendet einen Command an. false = ungueltig und folgenlos verworfen. */
export function applyCommand(world: World, cmd: Command): boolean {
  switch (cmd.t) {
    case 'build':
      return doBuild(world, cmd.bt, cmd.x, cmd.y);
    case 'road':
      return doRoad(world, cmd.x, cmd.y);
    case 'demolish':
      return doDemolish(world, cmd.x, cmd.y);
  }
}

function doBuild(
  world: World,
  bt: BuildingType,
  x: number,
  y: number,
): boolean {
  if (!canPlaceBuilding(world, bt, x, y)) return false;

  const s = world.state;
  const id = s.nextId++;
  s.buildings.set(id, makeBuilding(id, bt, x, y));
  s.buildingAt.set(tileKey(x, y), id);
  // Ein Gebaeude ist selbst begehbar; die Strasse darunter waere sonst weg.
  s.roads.delete(tileKey(x, y));

  if (bt === BuildingType.Storehouse) {
    for (let i = 0; i < CARRIERS_PER_STOREHOUSE; i++) {
      const cid = s.nextId++;
      const carrier: Carrier = {
        id: cid,
        x: (x * FP_ONE) | 0,
        y: (y * FP_ONE) | 0,
        path: [],
        pathIdx: 0,
        state: CarrierState.Idle,
        carrying: -1,
        jobGood: -1,
        jobFrom: 0,
        jobTo: 0,
      };
      s.carriers.set(cid, carrier);
    }
  }

  return true;
}

function doRoad(world: World, x: number, y: number): boolean {
  const s = world.state;
  const key = tileKey(x, y);
  if (s.roads.has(key) || s.buildingAt.has(key)) return false;
  if (!isBuildable(getTile(world, x, y))) return false;
  s.roads.add(key);
  return true;
}

function doDemolish(world: World, x: number, y: number): boolean {
  const s = world.state;
  const key = tileKey(x, y);

  const id = buildingIdAt(world, x, y);
  if (id !== undefined) {
    s.buildings.delete(id);
    s.buildingAt.delete(key);
    // Laufende Auftraege loesen sich selbst auf: stepCarriers prueft, ob
    // Quelle und Ziel noch existieren.
    return true;
  }

  if (s.roads.has(key)) {
    s.roads.delete(key);
    return true;
  }

  return false;
}
