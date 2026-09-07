/**
 * Chunk-Cache fuer generiertes Terrain.
 *
 * Ein Chunk ist ausschliesslich abgeleitete Information: er laesst sich
 * jederzeit aus (seed, cx, cy) neu berechnen und wird deshalb NIE mutiert.
 * Alles, was der Spieler veraendert, liegt als Delta im WorldState.
 *
 * Dadurch ist der Cache kein Teil des Spielzustands - er darf verdraengt
 * werden, ohne dass sich die Simulation aendert.
 */

import { CHUNK_AREA, CHUNK_BITS, CHUNK_SIZE, chunkKey } from './coords';
import { generateTile, type Tile } from './terrain';

export class ChunkStore {
  readonly seed: number;
  private readonly max: number;
  /** Map haelt Einfuegereihenfolge -> aeltester Eintrag steht vorne (LRU). */
  private cache = new Map<string, Uint8Array>();
  private generated = 0;

  constructor(seed: number, maxChunks = 1024) {
    this.seed = seed;
    this.max = maxChunks;
  }

  get size(): number {
    return this.cache.size;
  }

  get generatedCount(): number {
    return this.generated;
  }

  /** Liefert den Chunk, generiert ihn bei Bedarf. */
  get(cx: number, cy: number): Uint8Array {
    const key = chunkKey(cx, cy);
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      // Auf die juengste Position schieben.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const chunk = this.generate(cx, cy);
    this.cache.set(key, chunk);
    this.evict();
    return chunk;
  }

  /** Ohne Generierung - fuer Renderer, die ihr Budget pro Frame begrenzen. */
  peek(cx: number, cy: number): Uint8Array | undefined {
    return this.cache.get(chunkKey(cx, cy));
  }

  has(cx: number, cy: number): boolean {
    return this.cache.has(chunkKey(cx, cy));
  }

  clear(): void {
    this.cache.clear();
  }

  private generate(cx: number, cy: number): Uint8Array {
    const tiles = new Uint8Array(CHUNK_AREA);
    const ox = cx << CHUNK_BITS;
    const oy = cy << CHUNK_BITS;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const row = ly << CHUNK_BITS;
      const wy = oy + ly;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        tiles[row + lx] = generateTile(this.seed, ox + lx, wy) as number;
      }
    }
    this.generated++;
    return tiles;
  }

  private evict(): void {
    while (this.cache.size > this.max) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}

/** Terrain ohne Spielerbauten. */
export function terrainAt(
  store: ChunkStore,
  x: number,
  y: number,
): Tile {
  const chunk = store.get(x >> CHUNK_BITS, y >> CHUNK_BITS);
  return chunk[((y & (CHUNK_SIZE - 1)) << CHUNK_BITS) | (x & (CHUNK_SIZE - 1))] as Tile;
}
