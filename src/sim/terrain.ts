/**
 * Prozedurale Terraingenerierung. Reine Funktion von (seed, x, y) -
 * daher ist die Karte unendlich gross, ohne dass irgendetwas gespeichert wird.
 */

import { FP_ONE } from './fixed';
import { fbm } from './noise';

export const Tile = {
  Water: 0,
  Sand: 1,
  Grass: 2,
  Forest: 3,
  Stone: 4,
  Mountain: 5,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export const TILE_NAMES: Record<Tile, string> = {
  [Tile.Water]: 'Wasser',
  [Tile.Sand]: 'Sand',
  [Tile.Grass]: 'Gras',
  [Tile.Forest]: 'Wald',
  [Tile.Stone]: 'Stein',
  [Tile.Mountain]: 'Berg',
};

/**
 * Konstante aus einem Literal. Wird einmal beim Laden ausgewertet;
 * Literal-Parsing und Multiplikation sind in IEEE-754 exakt festgelegt,
 * das Ergebnis ist also auf jeder Engine dieselbe Ganzzahl.
 */
const F = (n: number): number => Math.round(n * FP_ONE);

// Hoehenschwellen. Grosse Basiszelle (2^9 = 512 Tiles) erzeugt Kontinente
// statt Rauschen, die feineren Oktaven bringen Kuestenlinien und Huegel.
//
// Die Werte sind an der gemessenen Verteilung von fbm() ausgerichtet, nicht
// geraten: FBM mittelt ueber Oktaven und liefert deshalb keine gleichmaessige
// Streuung ueber [-1,1], sondern ein schmales, leicht nach oben verschobenes
// Band um den Median (~0.04). Schwellen weit draussen wuerden ganze
// Terrainarten praktisch nie erzeugen.
// Zielverteilung ungefaehr: 22% Wasser, 7% Sand, 8% Stein, 4% Berg, Rest Land.
const H_WATER = F(-0.157);
const H_SAND = F(-0.111);
const H_STONE = F(0.3);
const H_MOUNTAIN = F(0.419);
const FOREST_THRESHOLD = F(0.04);

const HEIGHT_OCTAVES = 6;
// 2^7 = 128 Tiles Basiszelle. Groesser sah zunaechst "kontinentaler" aus,
// erzeugte aber Regionen, die ueber einen ganzen Bildschirm hinweg nur aus
// Wasser oder nur aus Land bestehen. 128 zusammen mit gain 0.65 haelt den
// Wasseranteil pro Bildschirm zuverlaessig zwischen etwa 8 und 35 Prozent.
const HEIGHT_CELL_BITS = 7;
const HEIGHT_GAIN = F(0.65);
const FOREST_OCTAVES = 3;
const FOREST_CELL_BITS = 6;

const FOREST_SEED_OFFSET = 0x5bf03635 | 0;

export function heightAt(seed: number, x: number, y: number): number {
  return fbm(seed, x, y, HEIGHT_OCTAVES, HEIGHT_CELL_BITS, HEIGHT_GAIN);
}

/** Terrain an einer Weltposition. Kennt keine Spielerbauten. */
export function generateTile(seed: number, x: number, y: number): Tile {
  const h = heightAt(seed, x, y);

  if (h < H_WATER) return Tile.Water;
  if (h < H_SAND) return Tile.Sand;
  if (h > H_MOUNTAIN) return Tile.Mountain;
  if (h > H_STONE) return Tile.Stone;

  const forest = fbm(
    (seed + FOREST_SEED_OFFSET) | 0,
    x,
    y,
    FOREST_OCTAVES,
    FOREST_CELL_BITS,
  );
  return forest > FOREST_THRESHOLD ? Tile.Forest : Tile.Grass;
}

/** Begehbar fuer Strassen und Gebaeude. */
export function isBuildable(t: Tile): boolean {
  return t === Tile.Grass || t === Tile.Sand || t === Tile.Forest;
}
