/**
 * Commands sind die EINZIGE Art, den Weltzustand zu veraendern.
 *
 * Das ist die Voraussetzung fuer Lockstep: ueber das Netz wandern spaeter
 * nur diese Objekte, jeder Client wendet dieselbe Liste in derselben
 * Reihenfolge an und kommt damit auf denselben Zustand. Direkte
 * Schreibzugriffe aus dem Client wuerden diese Kette sofort brechen.
 */

import { NEIGHBORS, tileKey } from './coords';
import { FP_ONE } from './fixed';
import {
  buildingIdAt,
  canPlaceBuilding,
  forEachFootprint,
  makeBuilding,
  type World,
} from './state';
import { isBuildable } from './terrain';
import { getTile } from './state';
import {
  BUILDING_SPECS,
  BuildingType,
  CarrierState,
  GOOD_COUNT,
  Good,
  type Carrier,
} from './types';

export type Command =
  | { t: 'build'; bt: BuildingType; x: number; y: number }
  | { t: 'road'; x: number; y: number }
  | { t: 'demolish'; x: number; y: number };

/** Jedes neue Lager bringt eigene Traeger mit. */
const CARRIERS_PER_STOREHOUSE = 4;

/**
 * Startausstattung des allerersten Gebaeudes.
 *
 * Ohne sie waere das Spiel nicht startbar: jedes Gebaeude kostet Bretter,
 * Bretter kommen aus dem Saegewerk, und das Saegewerk kostet Bretter. Der
 * erste Bau ist deshalb geschenkt und - wenn es ein Lager ist - gefuellt.
 */
const STARTER_PLANKS = 12;
const STARTER_STONE = 8;
/**
 * Auch Holz, damit sich das Saegewerk sofort bauen laesst.
 *
 * Seit die Kosten beim Setzen abgebucht werden statt angeliefert zu
 * werden, muesste man sonst erst den kostenlosen Holzfaeller bauen, eine
 * Strasse ziehen und warten, bis drei Holz im Lager liegen - bevor
 * ueberhaupt etwas anderes moeglich ist.
 */
const STARTER_WOOD = 6;

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
  // isFirst haengt an nextId und nicht an buildings.size: sonst liesse
  // sich durch Abreissen aller Gebaeude der Startvorrat neu abholen.
  const isFirst = s.nextId === 1;

  // Zwei Ausnahmen von den Baukosten, beide gegen Sackgassen:
  //
  //  - Der allererste Bau einer Welt ist geschenkt, und ist es ein Lager,
  //    auch gefuellt. Ohne das gaebe es keinen Startpunkt.
  //  - Gibt es kein Lager mehr, ist das naechste umsonst - aber leer. Ohne
  //    Lager gibt es keine Traeger und damit keinen Weg zurueck. Weil es
  //    leer bleibt, laesst sich damit nichts erwirtschaften.
  const rescue = bt === BuildingType.Storehouse && !hasStorehouse(s);
  if (!isFirst && !rescue && !payCost(s, BUILDING_SPECS[bt].cost)) return false;

  const id = s.nextId++;
  const building = makeBuilding(id, bt, x, y);
  if (isFirst && bt === BuildingType.Storehouse) {
    building.input[Good.Wood] = STARTER_WOOD;
    building.input[Good.Plank] = STARTER_PLANKS;
    building.input[Good.Stone] = STARTER_STONE;
  }
  s.buildings.set(id, building);
  // Strassen unter der Flaeche gibt es nicht mehr - canPlaceBuilding
  // laesst dort gar nicht erst bauen.
  forEachFootprint(bt, x, y, (tx, ty) => {
    s.buildingAt.set(tileKey(tx, ty), id);
    // Unter dem Gebaeude liegt gestampfter Boden - der Renderer muss den
    // Chunk dafuer neu aufbauen.
    markRoadDirty(world, tx, ty);
  });

  if (bt === BuildingType.Storehouse) {
    for (let i = 0; i < CARRIERS_PER_STOREHOUSE; i++) {
      const cid = s.nextId++;
      const carrier: Carrier = {
        id: cid,
        // An der VORDERKANTE des Lagers, nicht auf der Ankerkachel.
        //
        // Auf dem Anker stehen sie mitten im Gebaeude: der Renderer
        // sortiert nach Fusspunkt, sie liegen dann hinter dem Haus und ihr
        // Kopf ragt ueber das Dach. An der Vorderkante stehen sie davor.
        x: (x * FP_ONE) | 0,
        y: ((y + BUILDING_SPECS[bt].footprint - 1) * FP_ONE) | 0,
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

/**
 * Kann dieses Gebaeude gerade bezahlt werden?
 *
 * Einzige Wahrheit ueber die Bezahlbarkeit - der Bau-Command UND die
 * Anzeige im Baumenue fragen hier. Vorher pruefte das Menue nur die
 * Lagerbestaende und kannte die Ausnahmen nicht: am Spielanfang ist das
 * Lager leer, also war alles ausser dem kostenlosen Holzfaeller
 * ausgegraut - obwohl der allererste Bau geschenkt ist.
 */
export function canAfford(world: World, type: BuildingType): boolean {
  const s = world.state;
  if (s.nextId === 1) return true; // allererster Bau
  if (type === BuildingType.Storehouse && !hasStorehouse(s)) return true; // Rettung
  const cost = BUILDING_SPECS[type].cost;
  for (let g = 0; g < GOOD_COUNT; g++) {
    if (availableStock(s, g as Good) < cost[g]) return false;
  }
  return true;
}

/**
 * Verfuegbarer Lagerbestand einer Ware ueber alle Lager.
 *
 * Reserviertes zaehlt nicht mit: diese Stuecke sind einem Traeger bereits
 * zugesagt, sie hier nochmal auszugeben wuerde den Bestand doppelt
 * verplanen.
 */
function availableStock(s: World['state'], good: Good): number {
  let n = 0;
  for (const b of s.buildings.values()) {
    if (!BUILDING_SPECS[b.type].isSink) continue;
    n += Math.max(0, b.input[good] - b.reserved[good]);
  }
  return n;
}

/**
 * Bucht die Baukosten sofort aus den Lagern ab.
 *
 * Gebaeude entstehen fertig - es gibt keine Baustelle und keine
 * Anlieferung mehr. Die Kette behaelt trotzdem ihren Zweck, weil ohne
 * Bretter und Steine schlicht nicht gebaut werden kann.
 *
 * Erst pruefen, dann abbuchen: sonst waere bei einer zu teuren Bauart die
 * erste Ware schon weg, wenn die zweite nicht reicht. Die Lager werden in
 * Id-Reihenfolge geleert, damit das Ergebnis reproduzierbar ist.
 */
function payCost(s: World['state'], cost: readonly number[]): boolean {
  for (let g = 0; g < GOOD_COUNT; g++) {
    if (availableStock(s, g as Good) < cost[g]) return false;
  }

  const ids = Array.from(s.buildings.keys()).sort((a, b) => a - b);
  for (let g = 0; g < GOOD_COUNT; g++) {
    let need = cost[g];
    for (const id of ids) {
      if (need <= 0) break;
      const b = s.buildings.get(id);
      if (!b || !BUILDING_SPECS[b.type].isSink) continue;
      const take = Math.min(need, Math.max(0, b.input[g] - b.reserved[g]));
      b.input[g] -= take;
      need -= take;
    }
  }
  return true;
}

const hasStorehouse = (s: World['state']): boolean => {
  for (const b of s.buildings.values()) {
    if (b.type === BuildingType.Storehouse) return true;
  }
  return false;
};

function doRoad(world: World, x: number, y: number): boolean {
  const s = world.state;
  const key = tileKey(x, y);
  if (s.roads.has(key) || s.buildingAt.has(key)) return false;
  if (!isBuildable(getTile(world, x, y))) return false;
  s.roads.add(key);
  markRoadDirty(world, x, y);
  return true;
}

/**
 * Meldet eine Kachel und ihre Nachbarn als neu zu zeichnen.
 *
 * Der Renderer baut Chunks einmal und behaelt sie. Gras neben einer
 * Strasse wird zu getretenem Boden - ohne diese Meldung bliebe der alte
 * Chunk stehen und die Anpassung erschiene erst, wenn er zufaellig aus dem
 * Cache faellt. Auch die vier Nachbarn, weil deren Boden ebenfalls kippt
 * und sie in einem anderen Chunk liegen koennen.
 */
function markRoadDirty(world: World, x: number, y: number): void {
  world.dirty.add(tileKey(x, y));
  for (const [dx, dy] of NEIGHBORS) world.dirty.add(tileKey(x + dx, y + dy));
}

function doDemolish(world: World, x: number, y: number): boolean {
  const s = world.state;
  const key = tileKey(x, y);

  const id = buildingIdAt(world, x, y);
  if (id !== undefined) {
    const b = s.buildings.get(id);
    s.buildings.delete(id);
    // Ueber die gespeicherte Ankerposition freigeben, nicht ueber die
    // angeklickte Kachel - sonst blieben die uebrigen Felder belegt.
    if (b) {
      forEachFootprint(b.type, b.x, b.y, (tx, ty) => {
        s.buildingAt.delete(tileKey(tx, ty));
        markRoadDirty(world, tx, ty);
      });
    }
    else s.buildingAt.delete(key);
    // Laufende Auftraege loesen sich selbst auf: stepCarriers prueft, ob
    // Quelle und Ziel noch existieren.
    return true;
  }

  if (s.roads.has(key)) {
    s.roads.delete(key);
    markRoadDirty(world, x, y);
    return true;
  }

  return false;
}
