/**
 * Canvas2D-Renderer mit Chunk-Cache.
 *
 * Kernidee: jeder Chunk wird genau einmal in ein eigenes Canvas gezeichnet
 * und danach pro Frame mit einem Draw-Call geblittet. Die Grundfarben liegen
 * weiter in einem 64x64-ImageData; die geladenen Texturen werden einmalig in
 * acht Pixel pro Tile daruebergelegt. So bleiben Details sichtbar, ohne im
 * laufenden Frame tausende Terrainbilder einzeln zu zeichnen.
 *
 * Der Renderer liest den Weltzustand ausschliesslich - er schreibt nie
 * hinein. Alles Zeitabhaengige (Interpolation) ist reiner Client-Zustand.
 */

import { HEIGHT_SHIFT, heightIndex } from '../sim/chunks';
import { CHUNK_BITS, CHUNK_SIZE, chunkKey, parseKey, tileKey } from '../sim/coords';
import { hash2i } from '../sim/hash';
import { FP_ONE } from '../sim/fixed';
import { buildingIdAt, hasRoad, type World } from '../sim/state';
import { Tile, waterDepth } from '../sim/terrain';
import { BUILDING_SPECS, GOOD_COUNT, type Building, type Carrier } from '../sim/types';
import type { CarrierDirection, GameAssets } from './assets';
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
/** Detailaufloesung des statischen Terrain-Chunk-Canvas. */
const TERRAIN_PX = 8;
/** 96 Chunks entsprechen rund 96 MiB Canvas-Pixeln statt ueber 500 MiB. */
const MAX_RENDER_CHUNKS = 96;
const SCENERY_MIN_ZOOM = 7;
const TREE_SEED = 0x4f2a19c3 | 0;
const RESOURCE_SEED = 0x315ca77d | 0;
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

type SceneObject =
  | { kind: 'tree'; x: number; y: number; image: HTMLImageElement }
  | { kind: 'resource'; x: number; y: number; image: HTMLImageElement }
  | { kind: 'building'; x: number; y: number; building: Building }
  | { kind: 'carrier'; x: number; y: number; carrier: Carrier };

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, HTMLCanvasElement>();
  /**
   * Vorgebackene Detailkacheln, je Quellbild eine.
   *
   * Zuvor wurde pro Tile ein drawImage mit Quellzuschnitt UND Skalierung
   * ausgefuehrt - 4096-mal je Chunk. Gemessen kostete ein Chunkaufbau
   * dadurch 24 ms, also anderthalb Bilder bei 60 Hz. Zuschnitt und
   * Skalierung passieren jetzt einmalig pro Variante, der Chunkaufbau
   * kopiert nur noch 8x8-Bloecke.
   */
  private detailTiles = new Map<HTMLImageElement, HTMLCanvasElement>();
  /** Positionen des vorherigen Ticks, fuer weiche Traegerbewegung. */
  private ghosts = new Map<number, Ghost>();
  private textureSeed: number;

  pendingChunks = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private world: World,
    private cam: Camera,
    private assets: GameAssets,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D nicht verfuegbar');
    this.ctx = ctx;
    this.textureSeed = (world.state.seed ^ 0x71ff3ab1) | 0;
  }

  get cachedChunks(): number {
    return this.cache.size;
  }

  setAssets(assets: GameAssets): void {
    this.assets = assets;
    this.cache.clear();
    this.detailTiles.clear();
  }

  /** Quellzuschnitt und Skalierung einer Terrainvariante, einmalig. */
  private detailTile(image: HTMLImageElement): HTMLCanvasElement {
    const cached = this.detailTiles.get(image);
    if (cached) return cached;

    const baked = document.createElement('canvas');
    baked.width = TERRAIN_PX;
    baked.height = TERRAIN_PX;
    const g = baked.getContext('2d');
    if (!g) throw new Error('Detail-Canvas nicht verfuegbar');
    g.imageSmoothingEnabled = true;
    // Die Atlasvorlage hat einen gemalten Rahmen/Schatten um jede Kachel.
    // Nur der innere Bereich wird uebernommen, sonst entstuende ein
    // sichtbares Schachbrettgitter.
    const crop = Math.max(
      1,
      Math.round(Math.min(image.naturalWidth, image.naturalHeight) * 0.08),
    );
    g.drawImage(
      image,
      crop, crop,
      image.naturalWidth - crop * 2, image.naturalHeight - crop * 2,
      0, 0, TERRAIN_PX, TERRAIN_PX,
    );
    this.detailTiles.set(image, baked);
    return baked;
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
    this.drawWorldObjects(alpha);
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
    el.width = CHUNK_SIZE * TERRAIN_PX;
    el.height = CHUNK_SIZE * TERRAIN_PX;
    const g = el.getContext('2d');
    if (!g) throw new Error('Chunk-Canvas nicht verfuegbar');

    const chunk = this.world.chunks.get(cx, cy);
    const overrides = this.world.state.terrainOverride;
    const img = g.createImageData(CHUNK_SIZE, CHUNK_SIZE);
    const data = img.data;
    const ox = cx << CHUNK_BITS;
    const oy = cy << CHUNK_BITS;

    const heights = chunk.height;

    // Spielerveraenderungen einmal einarbeiten statt in beiden Schleifen je
    // Tile nachzuschlagen: der Override-Lookup baut pro Aufruf einen String
    // aus den Koordinaten, das waeren 8192 Allokationen pro Chunkaufbau.
    let tiles = chunk.tiles;
    if (overrides.size > 0) {
      tiles = Uint8Array.from(chunk.tiles);
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const ov = overrides.get(tileKey(ox + lx, oy + ly));
          if (ov !== undefined) tiles[(ly << CHUNK_BITS) | lx] = ov as number;
        }
      }
    }

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = (ly << CHUNK_BITS) | lx;
        const wx = ox + lx;
        const wy = oy + ly;
        const tile = tiles[idx];
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

    const base = document.createElement('canvas');
    base.width = CHUNK_SIZE;
    base.height = CHUNK_SIZE;
    const baseCtx = base.getContext('2d');
    if (!baseCtx) throw new Error('Terrain-Basis-Canvas nicht verfuegbar');
    baseCtx.putImageData(img, 0, 0);

    g.imageSmoothingEnabled = false;
    g.drawImage(base, 0, 0, el.width, el.height);

    // Die AI-Vorlagen haben keine nahtlosen Kanten. Als halbtransparente
    // Detailebene ueber der prozeduralen Grundfarbe wirken sie organisch,
    // ohne Kontinentform und Tiefenschattierung zu ueberdecken.
    g.globalAlpha = 0.42;
    g.imageSmoothingEnabled = false;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const variants = this.terrainImages(tiles[(ly << CHUNK_BITS) | lx] as Tile);
        if (variants.length === 0) continue;
        const hash = hash2i(this.textureSeed, ox + lx, oy + ly) >>> 0;
        g.drawImage(
          this.detailTile(variants[hash % variants.length]),
          lx * TERRAIN_PX,
          ly * TERRAIN_PX,
        );
      }
    }
    g.globalAlpha = 1;
    return el;
  }

  private terrainImages(tile: Tile): HTMLImageElement[] {
    switch (tile) {
      case Tile.Water:
        return this.assets.terrain.water;
      case Tile.Sand:
        return this.assets.terrain.sand;
      case Tile.Grass:
        return this.assets.terrain.grass;
      case Tile.Forest:
        return this.assets.terrain.forest_ground;
      case Tile.Stone:
        return this.assets.terrain.dirt;
      case Tile.Mountain:
        return this.assets.terrain.snow;
    }
  }

  /** Haelt den Cache klein: alles weit ausserhalb des Sichtfelds fliegt raus. */
  private evictOffscreen(x0: number, y0: number, x1: number, y1: number): void {
    if (this.cache.size <= MAX_RENDER_CHUNKS) return;
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
    const sprites = this.assets.terrain.road;
    for (const key of this.world.state.roads) {
      const [x, y] = parseKey(key);
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
      const sx = cam.worldToScreenX(x);
      const sy = cam.worldToScreenY(y);
      ctx.fillStyle = ROAD_COLOR;
      ctx.fillRect(sx, sy, z, z);
      if (sprites.length > 0 && z >= 4) {
        const image = sprites[
          (hash2i(this.textureSeed ^ 0x218bc1, x, y) >>> 0) % sprites.length
        ];
        ctx.globalAlpha = 0.76;
        const crop = Math.max(
          1,
          Math.round(Math.min(image.naturalWidth, image.naturalHeight) * 0.08),
        );
        ctx.drawImage(
          image,
          crop,
          crop,
          image.naturalWidth - crop * 2,
          image.naturalHeight - crop * 2,
          sx,
          sy,
          z,
          z,
        );
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawWorldObjects(alpha: number): void {
    const { cam } = this;
    const v = cam.visibleTiles();
    const objects: SceneObject[] = [];

    if (cam.zoom >= SCENERY_MIN_ZOOM) this.collectScenery(v, objects);

    for (const b of this.world.state.buildings.values()) {
      if (b.x < v.x0 - 2 || b.x > v.x1 + 2 || b.y < v.y0 - 3 || b.y > v.y1 + 1) continue;
      objects.push({ kind: 'building', x: b.x, y: b.y, building: b });
    }

    for (const c of this.world.state.carriers.values()) {
      const cx = c.x / FP_ONE;
      const cy = c.y / FP_ONE;
      if (cx < v.x0 - 1 || cx > v.x1 + 1 || cy < v.y0 - 2 || cy > v.y1 + 1) continue;
      const ghost = this.ghosts.get(c.id);
      objects.push({
        kind: 'carrier',
        x: ghost ? ghost.px + (cx - ghost.px) * alpha : cx,
        y: ghost ? ghost.py + (cy - ghost.py) * alpha : cy,
        carrier: c,
      });
    }

    objects.sort((a, b) =>
      (a.y - b.y) || (a.x - b.x) || sceneOrder(a.kind) - sceneOrder(b.kind));

    for (const object of objects) {
      switch (object.kind) {
        case 'tree':
          this.drawBottomCentered(object.image, object.x + 0.5, object.y + 1, cam.zoom * 2.65);
          break;
        case 'resource':
          this.drawBottomCentered(object.image, object.x + 0.5, object.y + 0.95, cam.zoom * 1.35);
          break;
        case 'building':
          this.drawBuilding(object.building);
          break;
        case 'carrier':
          this.drawCarrier(object.carrier, object.x, object.y);
          break;
      }
    }
  }

  /**
   * Baeume und Felsen im Sichtfeld einsammeln.
   *
   * Bewusst chunkweise statt Tile fuer Tile ueber getTile: der Scan
   * beruehrt bei kleinem Zoom ueber 20 000 Kacheln pro Frame, und getTile
   * baut fuer den Override-Lookup jedes Mal einen String aus den
   * Koordinaten. Gemessen kostete allein das 6.8 ms pro Frame - mehr als
   * das gesamte uebrige Zeichnen. Hier wird direkt aus dem Chunk-Array
   * gelesen; Overrides und Belegung werden nur dort geprueft, wo sie
   * ueberhaupt eine Rolle spielen.
   */
  private collectScenery(
    v: { x0: number; y0: number; x1: number; y1: number },
    objects: SceneObject[],
  ): void {
    const state = this.world.state;
    const trees = this.assets.trees;
    const hasOverrides = state.terrainOverride.size > 0;
    const hasOccupants = state.roads.size > 0 || state.buildingAt.size > 0;
    const seed = state.seed;

    const x0 = v.x0 - 1, x1 = v.x1 + 1;
    const y0 = v.y0 - 2, y1 = v.y1 + 1;

    for (let cy = y0 >> CHUNK_BITS; cy <= (y1 >> CHUNK_BITS); cy++) {
      for (let cx = x0 >> CHUNK_BITS; cx <= (x1 >> CHUNK_BITS); cx++) {
        // peek statt get: was in diesem Frame nicht gezeichnet wird, soll
        // auch nicht extra generiert werden.
        const chunk = this.world.chunks.peek(cx, cy);
        if (!chunk) continue;

        const ox = cx << CHUNK_BITS;
        const oy = cy << CHUNK_BITS;
        const lyFrom = Math.max(0, y0 - oy);
        const lyTo = Math.min(CHUNK_SIZE - 1, y1 - oy);
        const lxFrom = Math.max(0, x0 - ox);
        const lxTo = Math.min(CHUNK_SIZE - 1, x1 - ox);

        for (let ly = lyFrom; ly <= lyTo; ly++) {
          const y = oy + ly;
          const row = ly << CHUNK_BITS;
          for (let lx = lxFrom; lx <= lxTo; lx++) {
            const x = ox + lx;
            let tile = chunk.tiles[row + lx] as Tile;
            if (hasOverrides) {
              const ov = state.terrainOverride.get(tileKey(x, y));
              if (ov !== undefined) tile = ov;
            }

            let image: HTMLImageElement | undefined;
            let kind: 'tree' | 'resource';

            if (tile === Tile.Forest) {
              if (trees.length === 0) continue;
              const hash = hash2i(seed ^ TREE_SEED, x, y) >>> 0;
              // Nicht jeder Waldtile bekommt einen Baum: das verhindert eine
              // undurchdringliche Spritewand und begrenzt die Draw-Calls.
              if ((hash & 7) !== 0) continue;
              image = trees[(hash >>> 8) % trees.length];
              kind = 'tree';
            } else if (tile === Tile.Stone || tile === Tile.Mountain) {
              const hash = hash2i(seed ^ RESOURCE_SEED, x, y) >>> 0;
              if ((hash & 3) !== 0) continue;
              const variants = tile === Tile.Stone
                ? this.assets.resources.stone
                : this.assets.resources.mountain;
              if (variants.length === 0) continue;
              image = variants[(hash >>> 8) % variants.length];
              kind = 'resource';
            } else {
              continue;
            }

            // Belegung erst pruefen, wenn ueberhaupt etwas gesetzt wuerde -
            // das betrifft nur jede achte bzw. vierte Kachel.
            if (hasOccupants
                && (hasRoad(this.world, x, y)
                    || buildingIdAt(this.world, x, y) !== undefined)) {
              continue;
            }

            objects.push({ kind, x, y, image });
          }
        }
      }
    }
  }

  private drawBottomCentered(
    image: HTMLImageElement,
    worldX: number,
    worldY: number,
    height: number,
  ): void {
    const width = height * (image.naturalWidth / image.naturalHeight);
    const x = this.cam.worldToScreenX(worldX) - width / 2;
    const y = this.cam.worldToScreenY(worldY) - height;
    this.ctx.drawImage(image, x, y, width, height);
  }

  private drawBuilding(b: Building): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const sprites = this.assets.buildings[b.type] ?? [];
    const image = sprites.length > 0 ? sprites[(b.id >>> 0) % sprites.length] : null;
    const sx = cam.worldToScreenX(b.x);
    const sy = cam.worldToScreenY(b.y);

    if (image) {
      this.drawBottomCentered(image, b.x + 0.5, b.y + 1.05, z * 3.15);
    } else {
      ctx.fillStyle = BUILDING_COLOR[b.type];
      ctx.fillRect(sx, sy, z, z);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, z - 1, z - 1);
    }

    if (z < 10) return;

    // Produktionsfortschritt und Waren bleiben als knappe Status-Overlays
    // erhalten; sie liegen an der logischen Kachel statt auf dem Dach.
    const spec = BUILDING_SPECS[b.type];
    if (spec.workTicks > 0 && b.progress >= 0) {
      const frac = b.progress / spec.workTicks;
      ctx.fillStyle = 'rgba(16,24,29,0.78)';
      ctx.fillRect(sx, sy + z - 3, z, 3);
      ctx.fillStyle = '#f4d35e';
      ctx.fillRect(sx, sy + z - 3, z * frac, 3);
    }

    let dot = 0;
    for (let g = 0; g < GOOD_COUNT; g++) {
      const n = b.output[g] + b.input[g];
      if (n === 0) continue;
      ctx.fillStyle = GOOD_COLOR[g as keyof typeof GOOD_COLOR];
      const r = Math.max(1.5, z * 0.1);
      ctx.beginPath();
      ctx.arc(sx + 3 + dot * (r * 2 + 2), sy + 3, r, 0, Math.PI * 2);
      ctx.fill();
      dot++;
    }
  }

  private drawCarrier(c: Carrier, x: number, y: number): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const r = Math.max(1.5, z * 0.18);
    const direction = this.carrierDirection(c, x, y);
    const image = this.assets.carrier[direction];
    const sx = cam.worldToScreenX(x + 0.5);
    const sy = cam.worldToScreenY(y + 0.62);

    if (image && z >= 5) {
      this.drawBottomCentered(image, x + 0.5, y + 0.72, z * 1.75);
    } else {
      ctx.fillStyle = CARRIER_COLOR;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (c.carrying >= 0 && z >= 8) {
      ctx.fillStyle = GOOD_COLOR[c.carrying as keyof typeof GOOD_COLOR];
      ctx.strokeStyle = 'rgba(20,18,14,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sx + z * 0.34, sy - z * 0.72, Math.max(2, z * 0.15), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private carrierDirection(c: Carrier, x: number, y: number): CarrierDirection {
    const targetX = c.path[c.pathIdx * 2];
    const targetY = c.path[c.pathIdx * 2 + 1];
    if (targetX === undefined || targetY === undefined) return 'down';
    const dx = targetX - x;
    const dy = targetY - y;
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
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

const sceneOrder = (kind: SceneObject['kind']): number => {
  switch (kind) {
    case 'tree': return 0;
    case 'resource': return 1;
    case 'building': return 2;
    case 'carrier': return 3;
  }
};

export type { Carrier };
