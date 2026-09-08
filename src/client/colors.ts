import { Tile } from '../sim/terrain';
import { BuildingType, Good } from '../sim/types';

/**
 * Wasser wird nicht mit einer festen Farbe gezeichnet, sondern zwischen
 * diesen beiden nach Tiefe interpoliert. Eine harte Grenze zwischen "flach"
 * und "tief" liest sich als zufaellige Flecken, ein Verlauf als Tiefe.
 */
export const WATER_SHALLOW: readonly [number, number, number] = [78, 132, 172];
export const WATER_DEEP: readonly [number, number, number] = [20, 42, 76];

/** Basisfarbe je Terrain als [r,g,b]. */
export const TILE_RGB: Record<Tile, readonly [number, number, number]> = {
  [Tile.Water]: [38, 78, 122],
  [Tile.Sand]: [201, 184, 132],
  [Tile.Grass]: [104, 148, 72],
  [Tile.Forest]: [42, 84, 46],
  [Tile.Stone]: [112, 107, 99],
  [Tile.Mountain]: [172, 170, 166],
};

export const BUILDING_COLOR: Record<BuildingType, string> = {
  [BuildingType.Woodcutter]: '#8a5a2b',
  [BuildingType.Sawmill]: '#c08a3e',
  [BuildingType.Storehouse]: '#9c5fbf',
  [BuildingType.Harbor]: '#3f88b5',
};

export const GOOD_COLOR: Record<Good, string> = {
  [Good.Wood]: '#7a4a1e',
  [Good.Plank]: '#d8a85a',
  [Good.Fish]: '#8fc7d4',
};

// Deutlich dunkler als Sand (#c9b884) gewaehlt: eine helle Strasse ist auf
// Sandtiles praktisch unsichtbar, waehrend dieser Ton auf Gras UND Sand traegt.
export const ROAD_COLOR = '#8a6f4a';
export const CARRIER_COLOR = '#f2f0e6';
