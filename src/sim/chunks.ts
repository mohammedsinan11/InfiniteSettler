/**
 * Chunk-Cache fuer generiertes Terrain.
 *
 * Ein Chunk ist ausschliesslich abgeleitete Information: er laesst sich
 * jederzeit aus (seed, cx, cy) neu berechnen und wird deshalb NIE mutiert.
 * Alles, was der Spieler veraendert, liegt als Delta im WorldState.
 *
 * Dadurch ist der Cache kein Teil des Spielzustands - er darf verdraengt
 * werden, ohne dass sich die Simulation aendert.
 *
 * Neben den Kachelarten wird auch die Hoehe gespeichert, weil der Renderer
 * daraus Wassertiefe und Reliefschattierung ableitet. Das Hoehenfeld hat
 * einen Rand von einem Tile, damit die Schattierung an Chunk-Grenzen den
 * Nachbarn kennt - ohne diesen Rand entstuenden dort sichtbare Fugen.
 */

import { CHUNK_AREA, CHUNK_BITS, CHUNK_SIZE, chunkKey } from './coords';
import { sampleTerrain, type Tile } from './terrain';

/** Kantenlaenge des Hoehenfeldes: Chunk plus ein Tile Rand oben und links. */
export const HEIGHT_STRIDE = CHUNK_SIZE + 1;

/**
 * Die Hoehe wird um so viele Bit heruntergeteilt gespeichert, damit sie in
 * Int16 passt (Wertebereich der Hoehe ist etwa +/-0.56 * FP_ONE).
 *
 * 4 statt 8 Bit ist kein Detail: bei 8 Bit unterscheiden sich benachbarte
 * Tiles meist gar nicht und gelegentlich um genau 1. Die Reliefschattierung
 * bildet Differenzen und zeigte deshalb deutliche Terrassenstreifen. Mit 4
 * Bit sind die Stufen 16-mal feiner und verschwinden im Rauschen.
 */
export const HEIGHT_SHIFT = 4;

export interface ChunkData {
  /** Kachelart je Tile, Index (ly << CHUNK_BITS) | lx. */
  tiles: Uint8Array;
  /**
   * Hoehe, um HEIGHT_SHIFT Bit heruntergeteilt.
   * Index: (ly + 1) * HEIGHT_STRIDE + (lx + 1), gueltig fuer lx, ly ab -1.
   */
  height: Int16Array;
}

export const heightIndex = (lx: number, ly: number): number =>
  (ly + 1) * HEIGHT_STRIDE + (lx + 1);

export class ChunkStore {
  readonly seed: number;
  private readonly max: number;
  /** Map haelt Einfuegereihenfolge -> aeltester Eintrag steht vorne (LRU). */
  private cache = new Map<string, ChunkData>();
  private generated = 0;

  constructor(seed: number, maxChunks = 640) {
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
  get(cx: number, cy: number): ChunkData {
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

  has(cx: number, cy: number): boolean {
    return this.cache.has(chunkKey(cx, cy));
  }

  clear(): void {
    this.cache.clear();
  }

  private generate(cx: number, cy: number): ChunkData {
    const tiles = new Uint8Array(CHUNK_AREA);
    const height = new Int16Array(HEIGHT_STRIDE * HEIGHT_STRIDE);
    const ox = cx << CHUNK_BITS;
    const oy = cy << CHUNK_BITS;

    // Ab -1, damit der Rand fuer die Schattierung mitkommt.
    for (let ly = -1; ly < CHUNK_SIZE; ly++) {
      const wy = oy + ly;
      const hRow = (ly + 1) * HEIGHT_STRIDE;
      for (let lx = -1; lx < CHUNK_SIZE; lx++) {
        const s = sampleTerrain(this.seed, ox + lx, wy);
        height[hRow + lx + 1] = s.height >> HEIGHT_SHIFT;
        if (lx >= 0 && ly >= 0) {
          tiles[(ly << CHUNK_BITS) | lx] = s.tile as number;
        }
      }
    }

    this.generated++;
    return { tiles, height };
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
export function terrainAt(store: ChunkStore, x: number, y: number): Tile {
  const chunk = store.get(x >> CHUNK_BITS, y >> CHUNK_BITS);
  return chunk.tiles[
    ((y & (CHUNK_SIZE - 1)) << CHUNK_BITS) | (x & (CHUNK_SIZE - 1))
  ] as Tile;
}
