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
import { getTile, isSailable, setTile, type World } from './state';
import { Tile } from './terrain';
import {
  BASE_SETTLERS,
  BUILDING_SPECS,
  BuildingType,
  FOODS,
  FOOD_TICKS,
  CARRIER_SPEED,
  SHIP_MIN_GAP,
  SHIP_SPEED,
  type Ship,
  CarrierState,
  GOOD_COUNT,
  type Building,
  type Carrier,
  type Good,
} from './types';

/** Wieviel Input ein Verbraucher hoechstens vorhalten will. */
const INPUT_TARGET = 4;
/**
 * Wieviel Nahrung ein Wohnhaus bevorratet.
 *
 * Klein gehalten: ein Haus, das zehn Fische hortet, entzieht sie den
 * anderen Haeusern und laesst die Siedlung ungleichmaessig verhungern.
 */
const HOUSE_FOOD_TARGET = 2;

const sortedIds = (m: Map<number, unknown>): number[] =>
  Array.from(m.keys()).sort((a, b) => a - b);

// --- Bevoelkerung ------------------------------------------------------

/**
 * Wieviele Siedler es gerade gibt.
 *
 * Abgeleitet, nicht gespeichert: ein Haus mit Nahrung im Bestand oder einer
 * noch wirkenden Mahlzeit ist bewohnt. Damit kann die Einwohnerzahl nicht vom
 * uebrigen Zustand abweichen - waere sie ein eigenes Feld, muesste sie bei
 * jedem Bau, Abriss und Ladevorgang mitgefuehrt werden.
 *
 * Dazu die Gruendergruppe, die es immer gibt: ohne sie koennte man das
 * erste Haus nie bauen.
 */
export function population(world: World): number {
  let n = BASE_SETTLERS;
  for (const b of world.state.buildings.values()) {
    const spec = BUILDING_SPECS[b.type];
    if (spec.settlers === 0) continue;
    if (isFed(b)) n += spec.settlers;
  }
  return n;
}

/**
 * Wieviele Arbeitsplaetze gerade besetzt werden wollen.
 *
 * Nur fuer die Anzeige: liegt der Wert ueber der Einwohnerzahl, stehen
 * Betriebe still, und das soll man sehen koennen, ohne es auf der Karte
 * zu suchen.
 */
export function workersNeeded(world: World): number {
  let n = 0;
  for (const b of world.state.buildings.values()) {
    if (BUILDING_SPECS[b.type].needsWorker) n++;
  }
  return n;
}

/** Hat das Haus Nahrung auf Vorrat oder wirkt die letzte Mahlzeit noch? */
const isFed = (b: Building): boolean =>
  b.progress > 0 || FOODS.some((g) => b.input[g] > 0);

/**
 * Mahlzeitentakt der Wohnhaeuser.
 *
 * progress zaehlt hier die Ticks bis zur naechsten Mahlzeit - dasselbe
 * Feld wie bei der Produktion, nur andere Bedeutung. Ein Haus ohne
 * Nahrung wartet einfach weiter; sobald etwas ankommt, isst es sofort.
 */
export function stepHouses(world: World): void {
  const buildings = world.state.buildings;
  for (const id of sortedIds(buildings)) {
    const b = buildings.get(id) as Building;
    if (BUILDING_SPECS[b.type].settlers === 0) continue;

    if (b.progress > 0) {
      b.progress--;
      continue;
    }
    // Brot zuerst - es haelt laenger vor.
    for (const good of FOODS) {
      if (b.input[good] <= 0) continue;
      b.input[good]--;
      b.progress = FOOD_TICKS[good] ?? 0;
      break;
    }
  }
}

// --- Produktion --------------------------------------------------------

export function stepProduction(world: World): void {
  const buildings = world.state.buildings;
  // Arbeitskraefte werden in Id-Reihenfolge vergeben: das aelteste
  // Gebaeude bekommt zuerst einen Siedler. Reicht die Bevoelkerung nicht,
  // stehen die zuletzt gebauten still - nachvollziehbar und ohne
  // Zufallsentscheidung.
  let workers = population(world);

  for (const id of sortedIds(buildings)) {
    const b = buildings.get(id) as Building;
    const spec = BUILDING_SPECS[b.type];

    if (spec.produces < 0) continue;
    if (spec.needsWorker) {
      if (workers <= 0) continue;
      workers--;
    }

    if (b.progress < 0) {
      if (b.output[spec.produces] >= spec.outputCap) continue;
      if (spec.consumes >= 0) {
        if (b.input[spec.consumes] < 1) continue;
        b.input[spec.consumes]--;
      } else if (spec.harvestTile >= 0 && harvestTarget(world, b) === null) {
        continue; // keine Rohstoffkachel mehr in Reichweite
      }
      b.progress = 0;
      continue;
    }

    b.progress++;
    if (b.progress < spec.workTicks) continue;

    if (spec.harvestTile >= 0) {
      const source = harvestTarget(world, b);
      if (source === null) {
        b.progress = spec.workTicks; // blockiert, bis wieder Rohstoff da ist
        continue;
      }
      // Nur erschoepfliche Quellen werden aufgebraucht: der Wald des
      // Holzfaellers wird zu Gras, das Wasser des Hafens bleibt Wasser.
      if (spec.harvestConsumes) setTile(world, source[0], source[1], Tile.Grass);
    }
    // Ein Umschlagplatz legt sein Erzeugnis gleich in den Bestand: dort
    // greifen Traeger und Schiffe darauf zu, im Ausgangspuffer nicht.
    const amount = b.type === BuildingType.Woodcutter
      ? 1 + world.state.run.bonuses.woodYield
      : 1;
    if (spec.isSink) b.input[spec.produces] += amount;
    else b.output[spec.produces] += amount;
    b.progress = -1;
  }
}

/**
 * Naechste Rohstoffkachel im Radius. Feste Scanreihenfolge und Auswahl nach
 * (Abstand, y, x) - damit ist die Wahl bei gleichem Zustand immer dieselbe.
 */
export function harvestTarget(world: World, b: Building): [number, number] | null {
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
  // Ein Wohnhaus nimmt jede Nahrung an, nicht nur eine bestimmte.
  if (spec.settlers > 0) {
    if (!FOODS.includes(good)) return 0;
    let stock = 0;
    for (const g of FOODS) stock += b.input[g] + b.incoming[g];
    return HOUSE_FOOD_TARGET - stock;
  }
  if (spec.consumes !== good) return 0;
  return INPUT_TARGET - b.input[good] - b.incoming[good];
}

/**
 * Wieviel dieses Gebaeude von good abzugeben hat.
 *
 * Ein Lager gibt aus seinem Bestand ab - sonst koennte eine Baustelle nie
 * beliefert werden, weil alle fertigen Waren dort landen und liegenbleiben.
 * Erzeuger geben nur aus ihrem Ausgangspuffer ab, nicht aus ihrem Eingang.
 */
function supplyOf(b: Building, good: Good): number {
  const spec = BUILDING_SPECS[b.type];
  const pool = spec.isSink ? b.input[good] : b.output[good];
  return pool - b.reserved[good];
}

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
          // Kein Landtransport zwischen zwei Umschlagplaetzen.
          //
          // Lager und Haefen nehmen beide alles an UND geben alles ab -
          // ohne diese Regel schaufeln Traeger dieselbe Ware endlos
          // zwischen ihnen hin und her, weil jeder vom anderen Bedarf
          // sieht. Ware zwischen Umschlagplaetzen bewegen Schiffe.
          if (BUILDING_SPECS[from.type].isSink && BUILDING_SPECS[to.type].isSink) {
            continue;
          }
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
      if (!from || !to || stockOf(from, good) < 1) {
        if (from) from.reserved[good] = Math.max(0, from.reserved[good] - 1);
        if (to) to.incoming[good] = Math.max(0, to.incoming[good] - 1);
        abortJob(c);
        continue;
      }

      takeFrom(from, good);
      from.reserved[good] = Math.max(0, from.reserved[good] - 1);
      c.carrying = good;

      const path = findPath(world, from.x, from.y, to.x, to.y);
      if (path === null) {
        // Ziel nicht mehr erreichbar: Ware zurueckgeben statt verschwinden lassen.
        giveBack(from, good);
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

/**
 * Wo der abgebbare Bestand eines Gebaeudes liegt.
 *
 * Erzeuger halten ihn im Ausgangspuffer, ein Lager in seinem Eingang -
 * dort landet ja alles Angelieferte. Ohne diese Unterscheidung koennte ein
 * Lager nichts wieder herausgeben und Baustellen blieben unbeliefert.
 */
const stockOf = (b: Building, good: Good): number =>
  BUILDING_SPECS[b.type].isSink ? b.input[good] : b.output[good];

function takeFrom(b: Building, good: Good): void {
  if (BUILDING_SPECS[b.type].isSink) b.input[good]--;
  else b.output[good]--;
}

function giveBack(b: Building, good: Good): void {
  if (BUILDING_SPECS[b.type].isSink) b.input[good]++;
  else b.output[good]++;
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
function advance(c: Carrier | Ship, speed: number = CARRIER_SPEED): boolean {
  let budget = speed;
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

// --- Seeverkehr --------------------------------------------------------

/**
 * Anlegestelle eines Hafens: die naechstgelegene Wasserkachel.
 *
 * Feste Scanreihenfolge, damit dieselbe Kachel immer dieselbe bleibt -
 * ein wechselnder Anleger liesse Schiffe zwischen zwei Feldern zittern.
 */
export function dockTile(world: World, harbor: Building): [number, number] | null {
  const n = BUILDING_SPECS[harbor.type].footprint;
  for (let r = 1; r <= 3; r++) {
    for (let dy = -r; dy < n + r; dy++) {
      for (let dx = -r; dx < n + r; dx++) {
        const x = harbor.x + dx;
        const y = harbor.y + dy;
        if (getTile(world, x, y) !== Tile.Water) continue;
        return [x, y];
      }
    }
  }
  return null;
}

/** Alle Bauten mit Anleger - kleiner wie grosser Hafen. */
const harborIds = (world: World): number[] =>
  sortedIds(world.state.buildings).filter(
    (id) => BUILDING_SPECS[(world.state.buildings.get(id) as Building).type].isPort,
  );

/**
 * Vergibt Schiffsauftraege.
 *
 * Regel: ein Schiff faehrt, wenn ein Hafen von einer Ware deutlich mehr
 * hat als ein anderer. Das gleicht die Bestaende zwischen den Haefen aus,
 * ohne dass irgendwo ein globales Handelsnetz berechnet werden muesste -
 * jede Fahrt entscheidet sich allein aus zwei Lagerstaenden.
 *
 * Die Schwelle verhindert, dass Schiffe wegen eines einzigen Stuecks
 * endlos pendeln.
 */
export function assignShipJobs(world: World): void {
  const ships = world.state.ships;
  if (ships.size === 0) return;
  const buildings = world.state.buildings;
  const harbors = harborIds(world);
  if (harbors.length < 2) return;

  for (const sid of sortedIds(ships)) {
    const sh = ships.get(sid) as Ship;
    if (sh.state !== CarrierState.Idle) continue;

    let bestFrom: Building | null = null;
    let bestTo: Building | null = null;
    let bestGood: Good = 0 as Good;
    let bestGap = SHIP_MIN_GAP - 1;

    for (const fid of harbors) {
      const from = buildings.get(fid) as Building;
      for (const tid of harbors) {
        if (tid === fid) continue;
        const to = buildings.get(tid) as Building;
        for (let g = 0; g < GOOD_COUNT; g++) {
          const good = g as Good;
          // Unterwegs befindliche Ware auf beiden Seiten mitzaehlen, sonst
          // schicken mehrere Schiffe dieselbe Fracht.
          const have = from.input[good] - from.reserved[good];
          const gap = have - (to.input[good] + to.incoming[good]);
          if (gap <= bestGap) continue;
          bestGap = gap;
          bestFrom = from;
          bestTo = to;
          bestGood = good;
        }
      }
    }

    if (bestFrom === null || bestTo === null) continue;

    const dockA = dockTile(world, bestFrom);
    const dockB = dockTile(world, bestTo);
    if (!dockA || !dockB) continue;

    const toDock = findPath(
      world,
      Math.round(sh.x / FP_ONE),
      Math.round(sh.y / FP_ONE),
      dockA[0],
      dockA[1],
      isSailable,
    );
    if (toDock === null) continue;
    // Auch die zweite Etappe muss befahrbar sein - sonst legt das Schiff
    // ab und stellt erst am Ziel fest, dass es nicht hinkommt.
    if (findPath(world, dockA[0], dockA[1], dockB[0], dockB[1], isSailable) === null) {
      continue;
    }

    bestFrom.reserved[bestGood]++;
    bestTo.incoming[bestGood]++;
    sh.state = CarrierState.ToSource;
    sh.jobGood = bestGood;
    sh.jobFrom = bestFrom.id;
    sh.jobTo = bestTo.id;
    sh.path = toDock;
    sh.pathIdx = 0;
  }
}

/** Bewegt die Schiffe und wickelt Aufnahme und Abgabe ab. */
export function stepShips(world: World): void {
  const ships = world.state.ships;
  const buildings = world.state.buildings;

  for (const id of sortedIds(ships)) {
    const sh = ships.get(id) as Ship;
    if (sh.state === CarrierState.Idle) continue;
    if (!advance(sh, SHIP_SPEED)) continue;

    const from = buildings.get(sh.jobFrom);
    const to = buildings.get(sh.jobTo);
    const good = sh.jobGood as Good;

    if (sh.state === CarrierState.ToSource) {
      if (!from || !to || from.input[good] < 1) {
        if (from) from.reserved[good] = Math.max(0, from.reserved[good] - 1);
        if (to) to.incoming[good] = Math.max(0, to.incoming[good] - 1);
        abortShip(sh);
        continue;
      }
      from.input[good]--;
      from.reserved[good] = Math.max(0, from.reserved[good] - 1);
      sh.carrying = good;

      const dockB = dockTile(world, to);
      const path = dockB
        ? findPath(world, Math.round(sh.x / FP_ONE), Math.round(sh.y / FP_ONE),
                   dockB[0], dockB[1], isSailable)
        : null;
      if (path === null) {
        from.input[good]++;
        to.incoming[good] = Math.max(0, to.incoming[good] - 1);
        sh.carrying = -1;
        abortShip(sh);
        continue;
      }
      sh.state = CarrierState.ToDest;
      sh.path = path;
      sh.pathIdx = 0;
      continue;
    }

    if (to) {
      to.input[good]++;
      to.incoming[good] = Math.max(0, to.incoming[good] - 1);
    }
    sh.carrying = -1;
    abortShip(sh);
  }
}

function abortShip(sh: Ship): void {
  sh.state = CarrierState.Idle;
  sh.jobGood = -1;
  sh.jobFrom = 0;
  sh.jobTo = 0;
  sh.path = [];
  sh.pathIdx = 0;
}
