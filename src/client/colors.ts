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
  [Tile.Grass]: [96, 141, 74],
  [Tile.Forest]: [50, 92, 52],
  [Tile.Stone]: [126, 124, 118],
  [Tile.Mountain]: [162, 162, 158],
};

export const BUILDING_COLOR: Record<BuildingType, string> = {
  [BuildingType.Woodcutter]: '#8a5a2b',
  [BuildingType.Sawmill]: '#c08a3e',
  [BuildingType.Storehouse]: '#9c5fbf',
};

export const GOOD_COLOR: Record<Good, string> = {
  [Good.Wood]: '#7a4a1e',
  [Good.Plank]: '#d8a85a',
};

// Deutlich dunkler als Sand (#c9b884) gewaehlt: eine helle Strasse ist auf
// Sandtiles praktisch unsichtbar, waehrend dieser Ton auf Gras UND Sand traegt.
export const ROAD_COLOR = '#8a6f4a';
export const CARRIER_COLOR = '#f2f0e6';
