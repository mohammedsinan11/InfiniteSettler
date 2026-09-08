/**
 * Produktionskette und Warentransport.
 *
 * Kette: Holzfaeller -(Holz)-> Saegewerk -(Bretter)-> Lager.
 * Das Lager nimmt zusaetzlich Holz direkt an.
 *
 * Determinismus-Regel in dieser Datei: ueberall, wo die Reihenfolge das
 * Ergebnis beeinflusst (Auftragsvergabe, Traegerupdates, Baumsuche), wird
 * explizit ueber sortierte Ids bzw. in fester Scanreihenfolge iteriert -
 * nie ueber die Einfuegereihenfolge einer Map. Das ist zwar auch
 * deterministisch, aber eine Falle, sobald irgendwo umsortiert wird.
 */

import { FP_ONE } from './fixed';
import { findPath } from './pathfind';
import { getTile, setTile, type World } from './state';
import { Tile } from './terrain';
import {
  BUILDING_SPECS,
  CARRIER_SPEED,
  CarrierState,
  GOOD_COUNT,
  type Building,
  type Carrier,
  type Good,
} from './types';

/** Wieviel Input ein Verbraucher hoechstens vorhalten will. */
const INPUT_TARGET = 4;

const sortedIds = (m: Map<number, unknown>): number[] =>
  Array.from(m.keys()).sort((a, b) => a - b);

// --- Produktion --------------------------------------------------------

export function stepProduction(world: World): void {
  const buildings = world.state.buildings;
  for (const id of sortedIds(buildings)) {
    const b = buildings.get(id) as Building;
    const spec = BUILDING_SPECS[b.type];
    if (spec.produces < 0) continue;

    if (b.progress < 0) {
      if (b.output[spec.produces] >= spec.outputCap) continue;
      if (spec.consumes >= 0) {
        if (b.input[spec.consumes] < 1) continue;
        b.input[spec.consumes]--;
      } else if (spec.harvestTile >= 0 && findHarvest(world, b) === null) {
        continue; // keine Rohstoffkachel mehr in Reichweite
      }
      b.progress = 0;
      continue;
    }

    b.progress++;
    if (b.progress < spec.workTicks) continue;

    if (spec.harvestTile >= 0) {
      const source = findHarvest(world, b);
      if (source === null) {
        b.progress = spec.workTicks; // blockiert, bis wieder Rohstoff da ist
        continue;
      }
      // Nur erschoepfliche Quellen werden aufgebraucht: der Wald des
      // Holzfaellers wird zu Gras, das Wasser des Hafens bleibt Wasser.
      if (spec.harvestConsumes) setTile(world, source[0], source[1], Tile.Grass);
    }
    b.output[spec.produces]++;
    b.progress = -1;
  }
}

/**
 * Naechste Rohstoffkachel im Radius. Feste Scanreihenfolge und Auswahl nach
 * (Abstand, y, x) - damit ist die Wahl bei gleichem Zustand immer dieselbe.
 */
function findHarvest(world: World, b: Building): [number, number] | null {
  const spec = BUILDING_SPECS[b.type];
  const want = spec.harvestTile;
  const r = spec.harvestRadius;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d = dx * dx + dy * dy;
      if (d > r * r || d >= bestD) continue;
      const x = b.x + dx;
      const y = b.y + dy;
      if (getTile(world, x, y) !== want) continue;
      best = [x, y];
      bestD = d;
    }
  }
  return best;
}

// --- Auftragsvergabe ---------------------------------------------------

/** Wieviel dieses Gebaeude von good noch aufnehmen will. */
function demandFor(b: Building, good: Good): number {
  const spec = BUILDING_SPECS[b.type];
  if (spec.isSink) return 99; // Lager nimmt alles
  if (spec.consumes !== good) return 0;
  return INPUT_TARGET - b.input[good] - b.incoming[good];
}

/** Wieviel dieses Gebaeude von good abzugeben hat. */
const supplyOf = (b: Building, good: Good): number =>
  b.output[good] - b.reserved[good];

export function assignJobs(world: World): void {
  const buildings = world.state.buildings;
  const carriers = world.state.carriers;
  const buildingIds = sortedIds(buildings);

  for (const cid of sortedIds(carriers)) {
    const c = carriers.get(cid) as Carrier;
    if (c.state !== CarrierState.Idle) continue;

    const cx = c.x / FP_ONE;
    const cy = c.y / FP_ONE;

    let bestFrom: Building | null = null;
    let bestTo: Building | null = null;
    let bestGood: Good = 0 as Good;
    let bestScore = Infinity;

    for (const fid of buildingIds) {
      const from = buildings.get(fid) as Building;
      for (let g = 0; g < GOOD_COUNT; g++) {
        const good = g as Good;
        if (supplyOf(from, good) <= 0) continue;

        for (const tid of buildingIds) {
          if (tid === fid) continue;
          const to = buildings.get(tid) as Building;
          if (demandFor(to, good) <= 0) continue;

          // Kosten: Weg zum Erzeuger plus Weg zum Verbraucher (Manhattan-Schaetzung).
          const score =
            Math.abs(cx - from.x) +
            Math.abs(cy - from.y) +
            Math.abs(from.x - to.x) +
            Math.abs(from.y - to.y);
          if (score >= bestScore) continue; // Gleichstand: kleinere Id gewinnt
          bestScore = score;
          bestFrom = from;
          bestTo = to;
          bestGood = good;
        }
      }
    }

    if (bestFrom === null || bestTo === null) continue;

    const path = findPath(
      world,
      Math.round(cx),
      Math.round(cy),
      bestFrom.x,
      bestFrom.y,
    );
    if (path === null) continue; // nicht angebunden - naechster Tick erneut

    bestFrom.reserved[bestGood]++;
    bestTo.incoming[bestGood]++;
    c.state = CarrierState.ToSource;
    c.jobGood = bestGood;
    c.jobFrom = bestFrom.id;
    c.jobTo = bestTo.id;
    c.path = path;
    c.pathIdx = 0;
  }
}

// --- Traegerbewegung ---------------------------------------------------

export function stepCarriers(world: World): void {
  const carriers = world.state.carriers;
  const buildings = world.state.buildings;

  for (const id of sortedIds(carriers)) {
    const c = carriers.get(id) as Carrier;
    if (c.state === CarrierState.Idle) continue;
    if (!advance(c)) continue;

    if (c.state === CarrierState.ToSource) {
      const from = buildings.get(c.jobFrom);
      const to = buildings.get(c.jobTo);
      const good = c.jobGood as Good;

      // Quelle oder Ziel koennten inzwischen abgerissen worden sein.
      if (!from || !to || from.output[good] < 1) {
        if (from) from.reserved[good] = Math.max(0, from.reserved[good] - 1);
        if (to) to.incoming[good] = Math.max(0, to.incoming[good] - 1);
        abortJob(c);
        continue;
      }

      from.output[good]--;
      from.reserved[good] = Math.max(0, from.reserved[good] - 1);
      c.carrying = good;

      const path = findPath(world, from.x, from.y, to.x, to.y);
      if (path === null) {
        // Ziel nicht mehr erreichbar: Ware zurueckgeben statt verschwinden lassen.
        from.output[good]++;
        to.incoming[good] = Math.max(0, to.incoming[good] - 1);
        c.carrying = -1;
        abortJob(c);
        continue;
      }
      c.state = CarrierState.ToDest;
      c.path = path;
      c.pathIdx = 0;
      continue;
    }

    // ToDest
    const to = buildings.get(c.jobTo);
    const good = c.jobGood as Good;
    if (to) {
      to.input[good]++;
      to.incoming[good] = Math.max(0, to.incoming[good] - 1);
    }
    c.carrying = -1;
    abortJob(c);
  }
}

function abortJob(c: Carrier): void {
  c.state = CarrierState.Idle;
  c.jobGood = -1;
  c.jobFrom = 0;
  c.jobTo = 0;
  c.path = [];
  c.pathIdx = 0;
}

/**
 * Bewegt den Traeger um CARRIER_SPEED entlang seines Pfads.
 * Gibt true zurueck, wenn das Pfadende erreicht ist.
 *
 * Weil Pfade achsenparallel sind, ist die Manhattan-Distanz zum naechsten
 * Wegpunkt gleich der tatsaechlichen - es braucht keine Wurzel.
 */
function advance(c: Carrier): boolean {
  let budget = CARRIER_SPEED;
  const points = c.path.length >> 1;

  while (budget > 0) {
    if (c.pathIdx >= points) return true;

    const tx = (c.path[c.pathIdx * 2] * FP_ONE) | 0;
    const ty = (c.path[c.pathIdx * 2 + 1] * FP_ONE) | 0;
    const dx = (tx - c.x) | 0;
    const dy = (ty - c.y) | 0;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist === 0) {
      c.pathIdx++;
      continue;
    }

    if (dist <= budget) {
      c.x = tx;
      c.y = ty;
      budget -= dist;
      c.pathIdx++;
      continue;
    }

    const stepX = dx === 0 ? 0 : dx > 0 ? Math.min(budget, dx) : -Math.min(budget, -dx);
    const rest = budget - Math.abs(stepX);
    const stepY = dy === 0 ? 0 : dy > 0 ? Math.min(rest, dy) : -Math.min(rest, -dy);
    c.x = (c.x + stepX) | 0;
    c.y = (c.y + stepY) | 0;
    budget = 0;
  }

  return c.pathIdx >= points;
}
