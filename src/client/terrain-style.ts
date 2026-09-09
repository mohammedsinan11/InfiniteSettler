/**
 * Reine, deterministische Stilregeln fuer den Terrain-Renderer.
 *
 * Sie stehen bewusst ausserhalb von renderer.ts: Materialhierarchie und
 * grossraeumige Farbvariation lassen sich so testen, ohne Canvas oder DOM.
 */

import { hash2i } from '../sim/hash';
import { Tile } from '../sim/terrain';
import type { TerrainSprite } from './assets';

/**
 * An einer Grenze malt immer nur das Material mit der hoeheren Prioritaet
 * einen schmalen Saum in das niedrigere. Gegenseitiges Mischen erzeugt den
 * sichtbaren Wechsel A-B-A-B, der zuerst an der Kueste auffiel.
 */
const MATERIAL_PRIORITY: Readonly<Record<TerrainSprite, number>> = {
  water: 0,
  forest_ground: 1,
  grass: 2,
  sand: 3,
  rock: 4,
  dirt: 5,
  road: 6,
};

export function shouldOverlayNeighbor(
  current: TerrainSprite,
  neighbor: TerrainSprite,
): boolean {
  return MATERIAL_PRIORITY[neighbor] > MATERIAL_PRIORITY[current];
}

/**
 * Entfernt einzelne Wald- bzw. Wiesenkacheln aus einer ansonsten
 * geschlossenen Flaeche. Die Simulation behaelt dabei ihren echten Tiletyp;
 * diese Funktion bestimmt nur, welches Bodenmaterial der Renderer zeigt.
 */
export function smoothedVegetationTile(
  own: Tile,
  forestCount: number,
  vegetationCount: number,
): Tile {
  if (own !== Tile.Grass && own !== Tile.Forest) return own;
  if (vegetationCount < 5) return own;
  if (forestCount * 3 >= vegetationCount * 2) return Tile.Forest;
  if (forestCount * 3 <= vegetationCount) return Tile.Grass;
  return own;
}

export type TerrainTint = readonly [red: number, green: number, blue: number, alpha: number];

const LIGHT_TINT: Readonly<Record<Tile, readonly [number, number, number]>> = {
  [Tile.Water]: [78, 139, 157],
  [Tile.Sand]: [235, 211, 154],
  [Tile.Grass]: [165, 163, 76],
  [Tile.Forest]: [112, 116, 65],
  [Tile.Stone]: [166, 154, 132],
  [Tile.Mountain]: [202, 195, 177],
};

const DARK_TINT: Readonly<Record<Tile, readonly [number, number, number]>> = {
  [Tile.Water]: [19, 55, 87],
  [Tile.Sand]: [139, 112, 72],
  [Tile.Grass]: [43, 94, 53],
  [Tile.Forest]: [28, 57, 37],
  [Tile.Stone]: [78, 75, 72],
  [Tile.Mountain]: [112, 111, 108],
};

const clamp01 = (n: number): number => n < 0 ? 0 : n > 1 ? 1 : n;
const fade = (n: number): number => n * n * (3 - 2 * n);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Kontinuierliches Value-Noise in Weltkoordinaten, Wertebereich [-1, 1]. */
function valueNoise(seed: number, x: number, y: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const tx = fade((x - gx * cell) / cell);
  const ty = fade((y - gy * cell) / cell);
  const sample = (sx: number, sy: number): number =>
    (((hash2i(seed, sx, sy) >>> 8) & 0xffff) / 0x7fff) - 1;
  const top = mix(sample(gx, gy), sample(gx + 1, gy), tx);
  const bottom = mix(sample(gx, gy + 1), sample(gx + 1, gy + 1), tx);
  return mix(top, bottom, ty);
}

/**
 * Sehr langsame Farbstimmung fuer grosse Flaechen.
 *
 * Die eigentliche 32px-Textur liefert Halme, Koerner und Wellen. Diese Ebene
 * liefert aus der Ferne lesbare, mehrere Dutzend Kacheln grosse trockene,
 * feuchte, helle und dunkle Partien. Sie ist stetig ueber Chunkgrenzen und
 * beeinflusst ausschliesslich die Darstellung.
 */
export function terrainMacroMood(seed: number, x: number, y: number): number {
  const broad = valueNoise(seed ^ 0x63d83595, x, y, 56);
  const local = valueNoise(seed ^ 0x2f6e2b1d, x, y, 19);
  return broad * 0.72 + local * 0.28;
}

export function terrainTintForMood(mood: number, tile: Tile): TerrainTint {
  // Quadratwurzel hebt auch mittlere Ausschlaege an. Der vorige lineare
  // Verlauf lag in einer typischen Bildschirmregion im Mittel nur bei vier
  // Prozent Deckkraft und war damit aus der Fernansicht praktisch unsichtbar.
  const amount = Math.sqrt(clamp01(Math.abs(mood) * 1.25));
  if (amount <= 0) return [0, 0, 0, 0];

  const rgb = mood >= 0 ? LIGHT_TINT[tile] : DARK_TINT[tile];
  // Wald und Wiese duerfen lebendiger variieren, Wasser und Fels ruhiger.
  const maxAlpha = tile === Tile.Grass || tile === Tile.Forest ? 76
    : tile === Tile.Sand ? 58
      : tile === Tile.Water ? 38
        : 48;
  return [rgb[0], rgb[1], rgb[2], Math.round(amount * maxAlpha)];
}

export function terrainMacroTint(seed: number, x: number, y: number, tile: Tile): TerrainTint {
  return terrainTintForMood(terrainMacroMood(seed, x, y), tile);
}
