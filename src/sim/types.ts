import type { Fixed } from './fixed';
import { Tile } from './terrain';

export const Good = {
  Wood: 0,
  Plank: 1,
  Fish: 2,
  Stone: 3,
} as const;
export type Good = (typeof Good)[keyof typeof Good];

export const GOOD_COUNT = 4;
export const GOOD_NAMES: Record<Good, string> = {
  [Good.Wood]: 'Holz',
  [Good.Plank]: 'Bretter',
  [Good.Fish]: 'Fisch',
  [Good.Stone]: 'Stein',
};

/** Baukosten als Warenliste, Index = Good. */
export type Cost = readonly number[];

const cost = (entries: Partial<Record<Good, number>>): Cost => {
  const out = new Array<number>(GOOD_COUNT).fill(0);
  for (const [good, n] of Object.entries(entries)) out[Number(good)] = n as number;
  return out;
};

export const BuildingType = {
  Woodcutter: 0,
  Sawmill: 1,
  Storehouse: 2,
  Harbor: 3,
  Quarry: 4,
} as const;
export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];

/**
 * Wo ein Gebaeude stehen darf.
 *
 * Bis zum Hafen war die Regel fuer alle Gebaeude dieselbe ("bebaubarer,
 * freier Untergrund") und stand fest im Code. Der Hafen ist das erste
 * Gebaeude mit einer eigenen Bedingung - deshalb wird sie hier zur
 * Eigenschaft der Bauart, statt eine Sonderbehandlung einzubauen. Weitere
 * Gebaeude mit Lagebindung (Mine am Berg, Bruecke) brauchen dann nur einen
 * neuen Eintrag.
 */
export const Placement = {
  /** Ueberall auf bebaubarem Grund. */
  Land: 0,
  /** Braucht mindestens eine angrenzende Wasserkachel. */
  Coast: 1,
  /**
   * Braucht die eigene Rohstoffkachel (harvestTile) in Reichweite.
   *
   * Ohne diese Regel liess sich ein Steinbruch mitten auf der Wiese
   * setzen - er stand dann da und foerderte nie etwas, ohne dass man
   * erfuhr warum.
   */
  NearResource: 2,
} as const;
export type Placement = (typeof Placement)[keyof typeof Placement];

export interface BuildingSpec {
  readonly name: string;
  /** Verbrauch pro Produktionszyklus. */
  readonly consumes: Good | -1;
  readonly produces: Good | -1;
  /** Ticks pro Zyklus. Bei 20 Hz sind 60 Ticks = 3 Sekunden. */
  readonly workTicks: number;
  /** Wieviel Output das Gebaeude puffert, bevor es pausiert. */
  readonly outputCap: number;
  /**
   * Kachelart, aus der das Gebaeude seinen Rohstoff zieht, oder -1.
   * Frueher fest auf Wald verdrahtet; der Hafen erntet aus Wasser.
   */
  readonly harvestTile: Tile | -1;
  /** Radius in Tiles, in dem geerntet wird. */
  readonly harvestRadius: number;
  /**
   * Wird die geerntete Kachel dabei aufgebraucht?
   *
   * Beim Holzfaeller ja - der Wald wird zu Gras und waechst nicht nach,
   * das Gebaeude verhungert also irgendwann. Beim Hafen nein: Fisch ist
   * eine erneuerbare Quelle, die Wasserkachel bleibt.
   */
  readonly harvestConsumes: boolean;
  /**
   * Kantenlaenge der belegten Flaeche in Tiles (quadratisch).
   *
   * Bis hierher belegte jedes Gebaeude genau eine Kachel, waehrend sein
   * Sprite gut vier Kacheln breit gezeichnet wurde. Man konnte deshalb
   * eine Strasse mitten durch ein sichtbares Haus legen. Die Grundflaeche
   * bringt Bild und Spiellogik wieder zur Deckung.
   *
   * Anker ist die Kachel links oben; belegt sind (x..x+n-1, y..y+n-1).
   */
  readonly footprint: number;
  /** Wo das Gebaeude stehen darf. */
  readonly placement: Placement;
  /**
   * Was der Bau kostet. Wird beim Setzen sofort aus den Lagerbestaenden
   * abgebucht; reicht der Vorrat nicht, kommt der Bau nicht zustande.
   */
  readonly cost: Cost;
  /** Nimmt alles an und gibt nichts wieder ab. */
  readonly isSink: boolean;
}

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  [BuildingType.Woodcutter]: {
    name: 'Holzfaeller',
    // Bewusst kostenlos: er ist der Einstieg in die gesamte Kette. Kostete
    // er Bretter, koennte eine Siedlung ohne Bretter nie wieder welche
    // herstellen - eine Sackgasse ohne Ausweg.
    cost: cost({}),
    consumes: -1,
    produces: Good.Wood,
    workTicks: 60,
    outputCap: 4,
    harvestTile: Tile.Forest,
    harvestRadius: 6,
    harvestConsumes: true,
    footprint: 2,
    placement: Placement.Land,
    isSink: false,
  },
  [BuildingType.Sawmill]: {
    name: 'Saegewerk',
    // Kostet HOLZ, nicht Bretter. Sonst braeuchte man Bretter, um die
    // Brettproduktion zu bauen.
    cost: cost({ [Good.Wood]: 3 }),
    consumes: Good.Wood,
    produces: Good.Plank,
    workTicks: 40,
    outputCap: 4,
    harvestTile: -1,
    harvestRadius: 0,
    harvestConsumes: false,
    footprint: 2,
    placement: Placement.Land,
    isSink: false,
  },
  [BuildingType.Storehouse]: {
    name: 'Lager',
    cost: cost({ [Good.Plank]: 4, [Good.Stone]: 2 }),
    consumes: -1,
    produces: -1,
    workTicks: 0,
    outputCap: 0,
    harvestTile: -1,
    harvestRadius: 0,
    harvestConsumes: false,
    footprint: 2,
    placement: Placement.Land,
    isSink: true,
  },
  [BuildingType.Quarry]: {
    name: 'Steinbruch',
    cost: cost({ [Good.Plank]: 2 }),
    consumes: -1,
    produces: Good.Stone,
    workTicks: 75,
    outputCap: 4,
    harvestTile: Tile.Stone,
    harvestRadius: 5,
    // Fels ist endlich: der abgebaute Untergrund wird zu Gras, der
    // Steinbruch versiegt also wie der Holzfaeller.
    harvestConsumes: true,
    footprint: 2,
    placement: Placement.NearResource,
    isSink: false,
  },
  [BuildingType.Harbor]: {
    name: 'Hafen',
    cost: cost({ [Good.Plank]: 3, [Good.Stone]: 2 }),
    consumes: -1,
    produces: Good.Fish,
    // Langsamer als der Holzfaeller: der Hafen versiegt nie, dafuer
    // liefert er traeger.
    workTicks: 90,
    outputCap: 4,
    harvestTile: Tile.Water,
    // Kleiner Radius: der Hafen soll wirklich am Wasser stehen muessen und
    // nicht ein paar Kacheln landeinwaerts noch Fisch finden.
    harvestRadius: 3,
    harvestConsumes: false,
    footprint: 2,
    placement: Placement.Coast,
    // Der Hafen ist zugleich Umschlagplatz: Traeger liefern dort ab und
    // holen dort, Schiffe gleichen die Bestaende zwischen den Haefen aus.
    isSink: true,
  },
};

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  /** Fortschritt des laufenden Zyklus in Ticks. -1 = kein Zyklus aktiv. */
  progress: number;
  /** Bestand je Ware, Index = Good. */
  input: number[];
  output: number[];
  /** Von Traegern bereits zugesagte Abholungen - verhindert Doppelvergabe. */
  reserved: number[];
  /** Von Traegern bereits unterwegs hierher - verhindert Ueberlieferung. */
  incoming: number[];
}

export const CarrierState = {
  Idle: 0,
  ToSource: 1,
  ToDest: 2,
} as const;
export type CarrierState = (typeof CarrierState)[keyof typeof CarrierState];

export interface Carrier {
  id: number;
  /** Position in Fixed-Point-Tilekoordinaten. */
  x: Fixed;
  y: Fixed;
  /** Flacher Pfad [x0,y0,x1,y1,...]; pathIdx zeigt auf das naechste Ziel. */
  path: number[];
  pathIdx: number;
  state: CarrierState;
  carrying: Good | -1;
  jobGood: Good | -1;
  jobFrom: number;
  jobTo: number;
}

/** Traegergeschwindigkeit in Fixed-Point-Tiles pro Tick (1/8 Tile). */
export const CARRIER_SPEED = 1 << 13;

/**
 * Ein Schiff.
 *
 * Baugleich mit einem Traeger, nur faehrt es auf Wasser statt auf
 * Strassen und pendelt zwischen zwei Haefen. Deshalb dieselben Felder -
 * Bewegung und Wegabarbeitung teilen sich den Code.
 */
export interface Ship {
  id: number;
  x: Fixed;
  y: Fixed;
  path: number[];
  pathIdx: number;
  state: CarrierState;
  carrying: Good | -1;
  jobGood: Good | -1;
  jobFrom: number;
  jobTo: number;
  /** Heimathafen - dorthin kehrt es ohne Auftrag zurueck. */
  home: number;
}

/** Schiffe sind schneller als Traeger: freie Fahrt statt Trampelpfad. */
export const SHIP_SPEED = 1 << 14;
/**
 * Ab welchem Bestandsunterschied ein Schiff faehrt.
 *
 * Ohne Schwelle pendelten Schiffe endlos wegen eines einzigen Stuecks
 * zwischen zwei Haefen hin und her.
 */
export const SHIP_MIN_GAP = 3;
