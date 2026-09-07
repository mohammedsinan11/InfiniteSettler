import type { Fixed } from './fixed';

export const Good = {
  Wood: 0,
  Plank: 1,
} as const;
export type Good = (typeof Good)[keyof typeof Good];

export const GOOD_COUNT = 2;
export const GOOD_NAMES: Record<Good, string> = {
  [Good.Wood]: 'Holz',
  [Good.Plank]: 'Bretter',
};

export const BuildingType = {
  Woodcutter: 0,
  Sawmill: 1,
  Storehouse: 2,
} as const;
export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];

export interface BuildingSpec {
  readonly name: string;
  /** Verbrauch pro Produktionszyklus. */
  readonly consumes: Good | -1;
  readonly produces: Good | -1;
  /** Ticks pro Zyklus. Bei 20 Hz sind 60 Ticks = 3 Sekunden. */
  readonly workTicks: number;
  /** Wieviel Output das Gebaeude puffert, bevor es pausiert. */
  readonly outputCap: number;
  /** Nur Holzfaeller: Radius in Tiles, in dem Wald geschlagen wird. */
  readonly harvestRadius: number;
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
    harvestRadius: 6,
    isSink: false,
  },
  [BuildingType.Sawmill]: {
    name: 'Saegewerk',
    consumes: Good.Wood,
    produces: Good.Plank,
    workTicks: 40,
    outputCap: 4,
    harvestRadius: 0,
    isSink: false,
  },
  [BuildingType.Storehouse]: {
    name: 'Lager',
    consumes: -1,
    produces: -1,
    workTicks: 0,
    outputCap: 0,
    harvestRadius: 0,
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
