import type { Fixed } from './fixed';
import { Tile } from './terrain';

export const Good = {
  Wood: 0,
  Plank: 1,
  Fish: 2,
} as const;
export type Good = (typeof Good)[keyof typeof Good];

export const GOOD_COUNT = 3;
export const GOOD_NAMES: Record<Good, string> = {
  [Good.Wood]: 'Holz',
  [Good.Plank]: 'Bretter',
  [Good.Fish]: 'Fisch',
};

export const BuildingType = {
  Woodcutter: 0,
  Sawmill: 1,
  Storehouse: 2,
  Harbor: 3,
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
  /** Wo das Gebaeude stehen darf. */
  readonly placement: Placement;
  /** Nimmt alles an und gibt nichts wieder ab. */
  readonly isSink: boolean;
}

export const BUILDING_SPECS: Record<BuildingType, BuildingSpec> = {
  [BuildingType.Woodcutter]: {
    name: 'Holzfaeller',
    consumes: -1,
    produces: Good.Wood,
    workTicks: 60,
    outputCap: 4,
    harvestTile: Tile.Forest,
    harvestRadius: 6,
    harvestConsumes: true,
    placement: Placement.Land,
    isSink: false,
  },
  [BuildingType.Sawmill]: {
    name: 'Saegewerk',
    consumes: Good.Wood,
    produces: Good.Plank,
    workTicks: 40,
    outputCap: 4,
    harvestTile: -1,
    harvestRadius: 0,
    harvestConsumes: false,
    placement: Placement.Land,
    isSink: false,
  },
  [BuildingType.Storehouse]: {
    name: 'Lager',
    consumes: -1,
    produces: -1,
    workTicks: 0,
    outputCap: 0,
    harvestTile: -1,
    harvestRadius: 0,
    harvestConsumes: false,
    placement: Placement.Land,
    isSink: true,
  },
  [BuildingType.Harbor]: {
    name: 'Hafen',
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
    placement: Placement.Coast,
    isSink: false,
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
