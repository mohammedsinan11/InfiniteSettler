/**
 * Canvas2D-Renderer mit Chunk-Cache.
 *
 * Kernidee: jeder Chunk wird genau einmal in ein eigenes 64x64-Canvas
 * gezeichnet (ein Pixel pro Tile) und danach pro Frame nur noch mit
 * drawImage hochskaliert geblittet. Statt 4096 Rechtecken pro Chunk und
 * Frame kostet ein Chunk damit einen einzigen Draw-Call.
 *
 * Der Renderer liest den Weltzustand ausschliesslich - er schreibt nie
 * hinein. Alles Zeitabhaengige (Interpolation) ist reiner Client-Zustand.
 */

import { HEIGHT_SHIFT, heightIndex } from '../sim/chunks';
import { CHUNK_BITS, CHUNK_SIZE, chunkKey, parseKey, tileKey } from '../sim/coords';
import { hash2i } from '../sim/hash';
import { FP_ONE } from '../sim/fixed';
import type { World } from '../sim/state';
import { Tile, waterDepth } from '../sim/terrain';
import { BUILDING_SPECS, GOOD_COUNT, type Carrier } from '../sim/types';
import type { Camera } from './camera';
import {
  BUILDING_COLOR,
  CARRIER_COLOR,
  GOOD_COLOR,
  ROAD_COLOR,
  TILE_RGB,
  WATER_DEEP,
  WATER_SHALLOW,
} from './colors';

/**
 * Zeitbudget fuer das Aufbauen neuer Chunks pro Frame, in Millisekunden.
 *
 * Bewusst eine Zeit- und keine Stueckzahl: die Generierung kostet je nach
 * Maschine sehr unterschiedlich viel (hier gemessen rund 6 ms pro Chunk),
 * und eine feste Anzahl waere auf schwacher Hardware ein garantiertes
 * Ruckeln. Mindestens ein Chunk pro Frame wird immer gebaut, sonst kaeme
 * die Karte beim Scrollen nie hinterher.
 */
const CHUNK_BUILD_MS = 8;
const UNLOADED_COLOR = '#0d1319';
/**
 * Reliefschattierung nach ABSOLUTER Hoehe, nicht nach Steigung.
 *
 * Eine Steigungsschattierung (Differenz zum Nachbarn) sah zunaechst besser
 * aus, erzeugte aber deutliche Streifenmuster. Grund: das Domain Warping
 * verschiebt die Abfrageposition um ganze Tiles. Springt dieser Versatz um
 * eins, entsteht im Hoehenfeld eine winzige Unstetigkeit - und eine
 * Ableitung macht daraus eine sichtbare Linie. Die absolute Hoehe hat
 * dieselbe Unstetigkeit, dort faellt sie aber nicht auf.
 *
 * Werte in Einheiten von (Hoehe >> HEIGHT_SHIFT).
 */
const RELIEF_REF = 380;
const RELIEF_GAIN = 0.023;
const RELIEF_MAX = 22;

interface Ghost {
  px: number;
  py: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, HTMLCanvasElement>();
  /** Positionen des vorherigen Ticks, fuer weiche Traegerbewegung. */
  private ghosts = new Map<number, Ghost>();
  private textureSeed: number;

  pendingChunks = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private world: World,
    private cam: Camera,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D nicht verfuegbar');
    this.ctx = ctx;
    this.textureSeed = (world.state.seed ^ 0x71ff3ab1) | 0;
  }

  get cachedChunks(): number {
    return this.cache.size;
  }

  /** Nach jeder Terrainaenderung aufrufen, sonst zeigt der Cache Altes. */
  invalidateTile(x: number, y: number): void {
    this.cache.delete(chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS));
  }

  invalidateAll(): void {
    this.cache.clear();
    this.ghosts.clear();
  }

  /** Vor jedem Sim-Tick aufrufen: aktuelle Positionen werden zum Startpunkt. */
  snapshotCarriers(): void {
    const carriers = this.world.state.carriers;
    for (const c of carriers.values()) {
      const g = this.ghosts.get(c.id);
      if (g) {
        g.px = c.x / FP_ONE;
        g.py = c.y / FP_ONE;
      } else {
        this.ghosts.set(c.id, { px: c.x / FP_ONE, py: c.y / FP_ONE });
      }
    }
    for (const id of this.ghosts.keys()) {
      if (!carriers.has(id)) this.ghosts.delete(id);
    }
  }

  draw(alpha: number, hover: { x: number; y: number } | null): void {
    const { ctx, cam } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = UNLOADED_COLOR;
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    this.drawTerrain();
    this.drawRoads();
    this.drawBuildings();
    this.drawCarriers(alpha);
    if (hover) this.drawHover(hover.x, hover.y);
  }

  // --- Terrain ---------------------------------------------------------

  private drawTerrain(): void {
    const { ctx, cam } = this;
    const v = cam.visibleTiles();
    const c0x = v.x0 >> CHUNK_BITS;
    const c1x = v.x1 >> CHUNK_BITS;
    const c0y = v.y0 >> CHUNK_BITS;
    const c1y = v.y1 >> CHUNK_BITS;

    const deadline = performance.now() + CHUNK_BUILD_MS;
    let built = 0;
    let pending = 0;

    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const key = chunkKey(cx, cy);
        let img = this.cache.get(key);
        if (!img) {
          // Der erste Chunk wird immer gebaut, danach nur solange Zeit ist.
          if (built > 0 && performance.now() > deadline) {
            pending++;
            continue;
          }
          img = this.buildChunkCanvas(cx, cy);
          this.cache.set(key, img);
          built++;
        }

        // Kanten auf ganze Pixel runden, sonst entstehen Fugen zwischen Chunks.
        const ox = cx << CHUNK_BITS;
        const oy = cy << CHUNK_BITS;
        const sx0 = Math.round(cam.worldToScreenX(ox));
        const sy0 = Math.round(cam.worldToScreenY(oy));
        const sx1 = Math.round(cam.worldToScreenX(ox + CHUNK_SIZE));
        const sy1 = Math.round(cam.worldToScreenY(oy + CHUNK_SIZE));
        ctx.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0);
      }
    }

    this.pendingChunks = pending;
    this.evictOffscreen(c0x - 2, c0y - 2, c1x + 2, c1y + 2);
  }

  private buildChunkCanvas(cx: number, cy: number): HTMLCanvasElement {
    const el = document.createElement('canvas');
    el.width = CHUNK_SIZE;
    el.height = CHUNK_SIZE;
    const g = el.getContext('2d');
    if (!g) throw new Error('Chunk-Canvas nicht verfuegbar');

    const chunk = this.world.chunks.get(cx, cy);
    const overrides = this.world.state.terrainOverride;
    const img = g.createImageData(CHUNK_SIZE, CHUNK_SIZE);
    const data = img.data;
    const ox = cx << CHUNK_BITS;
    const oy = cy << CHUNK_BITS;

    const heights = chunk.height;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const wy = oy + ly;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = (ly << CHUNK_BITS) | lx;
        const wx = ox + lx;
        const ov = overrides.get(tileKey(wx, wy));
        const tile = ov !== undefined ? ov : chunk.tiles[idx];
        // Variation pro Tile. Bewusst je Kanal unterschiedlich: eine reine
        // Helligkeitsstreuung laesst grosse Flaechen weiter wie eine flache,
        // hochskalierte Luftaufnahme wirken, eine Farbtonstreuung nicht.
        const noise = hash2i(this.textureSeed, wx, wy);
        // Amplitude bewusst klein: staerker gestreut liest es sich als
        // Rauschen statt als Textur.
        const jr = ((noise & 15) - 7) * 0.8;
        const jg = (((noise >>> 4) & 15) - 7) * 0.8;
        const jb = (((noise >>> 8) & 15) - 7) * 0.8;
        const h = heights[heightIndex(lx, ly)];

        let r: number;
        let g2: number;
        let b: number;

        if (tile === Tile.Water) {
          const d = waterDepth(h << HEIGHT_SHIFT) / 65536;
          r = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * d;
          g2 = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * d;
          b = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * d;
        } else {
          // Hoeheres Gelaende heller, Senken dunkler.
          const rel = (h - RELIEF_REF) * RELIEF_GAIN;
          const shade = rel < -RELIEF_MAX ? -RELIEF_MAX : rel > RELIEF_MAX ? RELIEF_MAX : rel;
          const rgb = TILE_RGB[tile as keyof typeof TILE_RGB];
          r = rgb[0] + shade;
          g2 = rgb[1] + shade;
          b = rgb[2] + shade;
        }

        const p = idx << 2;
        data[p] = clamp255(r + jr);
        data[p + 1] = clamp255(g2 + jg);
        data[p + 2] = clamp255(b + jb);
        data[p + 3] = 255;
      }
    }

    g.putImageData(img, 0, 0);
    return el;
  }

  /** Haelt den Cache klein: alles weit ausserhalb des Sichtfelds fliegt raus. */
  private evictOffscreen(x0: number, y0: number, x1: number, y1: number): void {
    if (this.cache.size <= 512) return;
    for (const key of this.cache.keys()) {
      const [cx, cy] = parseKey(key);
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) this.cache.delete(key);
    }
  }

  // --- Overlays --------------------------------------------------------

  private drawRoads(): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const v = cam.visibleTiles();
    ctx.fillStyle = ROAD_COLOR;
    // Klein halten: bei grossem Abstand zerfaellt eine Strasse optisch
    // in einzelne Kacheln, statt als Weg lesbar zu sein.
    const inset = Math.max(0.5, z * 0.12);
    for (const key of this.world.state.roads) {
      const [x, y] = parseKey(key);
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
      ctx.fillRect(
        cam.worldToScreenX(x) + inset,
        cam.worldToScreenY(y) + inset,
        z - inset * 2,
        z - inset * 2,
      );
    }
  }

  private drawBuildings(): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const v = cam.visibleTiles();

    for (const b of this.world.state.buildings.values()) {
      if (b.x < v.x0 || b.x > v.x1 || b.y < v.y0 || b.y > v.y1) continue;
      const sx = cam.worldToScreenX(b.x);
      const sy = cam.worldToScreenY(b.y);

      ctx.fillStyle = BUILDING_COLOR[b.type];
      ctx.fillRect(sx, sy, z, z);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, z - 1, z - 1);

      if (z < 10) continue;

      // Produktionsfortschritt als Balken am unteren Rand.
      const spec = BUILDING_SPECS[b.type];
      if (spec.workTicks > 0 && b.progress >= 0) {
        const frac = b.progress / spec.workTicks;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(sx + 1, sy + z - 3, (z - 2) * frac, 2);
      }

      // Lagerbestand als kleine Punkte oben.
      let dot = 0;
      for (let g = 0; g < GOOD_COUNT; g++) {
        const n = b.output[g] + b.input[g];
        if (n === 0) continue;
        ctx.fillStyle = GOOD_COLOR[g as keyof typeof GOOD_COLOR];
        const r = Math.max(1, z * 0.09);
        ctx.beginPath();
        ctx.arc(sx + 3 + dot * (r * 2 + 2), sy + 3, r, 0, Math.PI * 2);
        ctx.fill();
        dot++;
      }
    }
  }

  private drawCarriers(alpha: number): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const v = cam.visibleTiles();
    const r = Math.max(1.5, z * 0.18);

    for (const c of this.world.state.carriers.values()) {
      const cx = c.x / FP_ONE;
      const cy = c.y / FP_ONE;
      if (cx < v.x0 || cx > v.x1 || cy < v.y0 || cy > v.y1) continue;

      // Zwischen der Position des letzten und des aktuellen Ticks interpolieren.
      const g = this.ghosts.get(c.id);
      const ix = g ? g.px + (cx - g.px) * alpha : cx;
      const iy = g ? g.py + (cy - g.py) * alpha : cy;

      const sx = cam.worldToScreenX(ix + 0.5);
      const sy = cam.worldToScreenY(iy + 0.5);

      ctx.fillStyle = CARRIER_COLOR;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();

      if (c.carrying >= 0 && z >= 8) {
        ctx.fillStyle = GOOD_COLOR[c.carrying as keyof typeof GOOD_COLOR];
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawHover(x: number, y: number): void {
    const { ctx, cam } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      cam.worldToScreenX(x) + 1,
      cam.worldToScreenY(y) + 1,
      cam.zoom - 2,
      cam.zoom - 2,
    );
  }
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

export type { Carrier };
