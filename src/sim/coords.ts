/**
 * Weltkoordinaten sind einfache int32-Tile-Koordinaten. Damit reicht die
 * Karte von -2^31 bis 2^31 Tiles in jede Richtung - praktisch unendlich.
 *
 * Wichtig fuer negative Koordinaten: >> ist ein arithmetischer Shift und
 * & maskiert vorzeichenlos, deshalb gilt x === (x >> B) * SIZE + (x & MASK)
 * auch links und oberhalb des Ursprungs.
 */

export const CHUNK_BITS = 6;
export const CHUNK_SIZE = 1 << CHUNK_BITS; // 64
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;

export const chunkOf = (v: number): number => v >> CHUNK_BITS;
export const localOf = (v: number): number => v & CHUNK_MASK;
export const tileIndex = (x: number, y: number): number =>
  (localOf(y) << CHUNK_BITS) | localOf(x);

export const chunkKey = (cx: number, cy: number): string => cx + ',' + cy;
export const tileKey = (x: number, y: number): string => x + ',' + y;

export function parseKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

/** 4er-Nachbarschaft, feste Reihenfolge (N, O, S, W). */
export const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
