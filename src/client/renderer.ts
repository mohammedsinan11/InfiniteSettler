/**
 * Canvas2D-Renderer mit Chunk-Cache.
 *
 * Kernidee: jeder Chunk wird genau einmal in ein eigenes Canvas gezeichnet
 * und danach pro Frame mit einem Draw-Call geblittet. Die Grundfarben liegen
 * weiter in einem 64x64-ImageData; die geladenen Texturen werden einmalig in
 * sechzehn Pixel pro Tile daruebergelegt. So bleiben Details sichtbar, ohne im
 * laufenden Frame tausende Terrainbilder einzeln zu zeichnen.
 *
 * Der Renderer liest den Weltzustand ausschliesslich - er schreibt nie
 * hinein. Alles Zeitabhaengige (Interpolation) ist reiner Client-Zustand.
 */

import { HEIGHT_SHIFT, heightIndex } from '../sim/chunks';
import { CHUNK_BITS, CHUNK_SIZE, NEIGHBORS, chunkKey, parseKey, tileKey } from '../sim/coords';
import { hash2i } from '../sim/hash';
import { FP_ONE } from '../sim/fixed';
import { buildingIdAt, getTile, hasRoad, type World } from '../sim/state';
import { Tile, waterDepth } from '../sim/terrain';
import { BUILDING_SPECS, BuildingType, GOOD_COUNT, type Building, type Carrier, type Ship } from '../sim/types';
import type { CarrierDirection, GameAssets, TerrainSprite } from './assets';
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
 * Detailaufloesung des statischen Terrain-Chunk-Canvas.
 *
 * 16 ist absichtlich ein ganzzahliger Teiler der nativen 32-px-Kacheln.
 * Bei 12 px musste der Browser ungleichmaessig herunterrechnen; zusammen
 * mit bilinearer Glaettung war genau das der verwaschene Eindruck des
 * Bodens. Die Chunkzahl ist bereits speicherbegrenzt, daher bleibt der
 * Mehrbedarf kontrolliert.
 */
const TERRAIN_PX = 16;
/** Deckkraft der Detailebene fuer nahtlose bzw. gerahmte Kacheln. */
const DETAIL_ALPHA_SEAMLESS = 1;
const DETAIL_ALPHA_FRAMED = 0.42;
/** Wie stark Tiefe und Relief ueber den Kacheln nachgezogen werden. */
const DEPTH_SHADE = 0.62;
const RELIEF_SHADE = 1.6;
/** Wie weit ein Nachbarboden in die Kachel hineingreift (Anteil der Kante). */
// Eine schmale Pixelkante reicht, um harte Treppen zu brechen. 0.7 zog den
// Nachbarboden fast durch die ganze Kachel und erzeugte breite, wechselnde
// Materialbaender - an der Kueste besonders sichtbar.
const EDGE_REACH = 0.38;
const EDGE_SEED = 0x51ed2b1f | 0;
/** Aufloesung der vorgebackenen Strassenkachel. */
const ROAD_PX = 32;
/** Bei 12 px je Kachel ist ein Chunkbild 768x768 - rund 2.25 MiB. */
const MAX_RENDER_CHUNKS = 48;
const SCENERY_MIN_ZOOM = 7;
/**
 * Ab welchem Zoom Blumen und Buesche gezeichnet werden.
 *
 * Deutlich hoeher als bei Baeumen: bei Zoom 7 waere eine Blume sechs Pixel
 * gross - unsichtbar, aber sie kostet denselben Draw-Call. Gemessen
 * machten sie in der Uebersicht ueber ein Drittel aller Szenenobjekte aus.
 */
const SCATTER_MIN_ZOOM = 13;
/**
 * Wie weit ein Gebaeudesprite ueber seine Grundflaeche hinausragen darf.
 *
 * Die Sprites bringen Zaun und Baeume rundherum mit, das eigentliche Haus
 * nimmt nur den mittleren Teil ein. Genau auf die Grundflaeche gezogen
 * wirkte es winzig neben den Strassenkacheln. Nach oben darf es ohnehin
 * ueberstehen: dort liegt in der 3/4-Ansicht "hinter" dem Gebaeude.
 */
const SPRITE_OVERHANG = 1.35;
const TREE_SEED = 0x4f2a19c3 | 0;
const SCATTER_SEED = 0x2c8f5b71 | 0;
const CLIFF_SEED = 0x7b3d19a5 | 0;

/**
 * Hoehe einer Figur in Kacheln.
 *
 * Vorher 1.75 - damit war ein Traeger fast so hoch wie ein Haus (die
 * Gebaeudesprites belegen zwei Kacheln und sind sichtbar rund 2.2 Kacheln
 * hoch). Ein Mensch von etwa 1.75 m entspricht bei diesem Massstab
 * ungefaehr einer Dreiviertelkachel.
 */
const CARRIER_HEIGHT = 0.75;

/** Wie weit der Hafen aus seiner Grundflaeche Richtung Wasser rueckt. */
const HARBOR_DOCK_SHIFT = 0.45;
/** Umkreis in Kacheln, in dem der Hafen nach Wasser sucht. */
const HARBOR_SCAN = 3;
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

/**
 * Welche Bildergruppe eine Kachelart bekommt.
 *
 * Bewusst eine Tabelle und kein switch: Terrainarten und Bildergruppen
 * sind zwei getrennte Dinge, und welche zu welcher passt, ist eine
 * Einstellung. Das Grafikpaket hat zum Beispiel keinen Felsboden - dafuer
 * traegt der Erdboden am besten.
 */
/**
 * Kacheln, die sich nahtlos fortsetzen (Satz v2).
 *
 * Fuer sie faellt der Randbeschnitt weg - sie haben keinen gemalten
 * Rahmen - und die Detailebene darf viel kraeftiger aufgetragen werden.
 * Die alten Kacheln (Strasse, Schnee) brauchen beides weiterhin.
 */
const SEAMLESS: ReadonlySet<TerrainSprite> = new Set<TerrainSprite>([
  'grass', 'sand', 'water', 'dirt', 'forest_ground', 'rock',
]);

const TILE_SPRITE: Record<Tile, TerrainSprite> = {
  [Tile.Water]: 'water',
  [Tile.Sand]: 'sand',
  [Tile.Grass]: 'grass',
  [Tile.Forest]: 'forest_ground',
  [Tile.Stone]: 'rock',
  // Berg und Fels teilen sich die Felskachel. Unterschieden werden sie
  // ueber die Reliefebene: hoeheres Gelaende wird heller nachgezogen, ein
  // Gipfel hebt sich damit von der Felsflanke ab. Eine eigene Schneekachel
  // gab es zwar, sie passte aber weder zur Hoehe dieser Berge noch zum
  // Rest des Satzes.
  [Tile.Mountain]: 'rock',
};

/** Was die Bauvorschau zeichnen soll. */
export interface BuildPreview {
  x: number;
  y: number;
  footprint: number;
  valid: boolean;
  snapped: boolean;
  image: HTMLImageElement | null;
}

/** Wie ein Hafen zum Wasser steht. */
interface HarborFacing {
  /** Tatsaechliche Richtung des Wassers, Index wie NEIGHBORS (N, O, S, W). */
  dir: number;
  /** Steg nach Osten statt nach Westen/Sueden - nur fuer den grossen Hafen. */
  mirrored: boolean;
  /** Versatz aus der Grundflaeche heraus Richtung Wasser, in Kacheln. */
  shiftX: number;
  shiftY: number;
}

/** NEIGHBORS-Index -> Name der Ansicht im Grafikpaket. */
const FACING_NAME = ['up', 'right', 'down', 'left'] as const;

interface Ghost {
  px: number;
  py: number;
}

type SceneObject =
  | { kind: 'cliff'; x: number; y: number; image: HTMLImageElement; dir: number }
  | { kind: 'ship'; x: number; y: number; ship: Ship }
  | { kind: 'scatter'; x: number; y: number; image: HTMLImageElement }
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
  private detailTiles = new Map<string, HTMLCanvasElement>();
  /** Maskierte Randkacheln je Textur, Richtung und Streuvariante. */
  private edgeTiles = new Map<string, HTMLCanvasElement>();
  /**
   * Verkleinerte Fassungen der Objektsprites, nach Zweierpotenzen gestuft.
   *
   * Ein Baum liegt als 41x105-PNG vor. Bei Uebersichtszoom wird er auf
   * etwa 18 Pixel gezeichnet - und das Herunterrechnen passiert dann bei
   * JEDEM der tausenden Baeume in JEDEM Frame. Einmal pro Groessenstufe
   * vorgebacken kostet das Zeichnen danach fast nichts. Gestuft, damit
   * beim Zoomen nicht bei jedem Zwischenwert neu gebacken wird.
   */
  private scaledSprites = new Map<string, HTMLCanvasElement>();
  /** Ausrichtung je Hafen - haengt nur am Gelaende. */
  private harborFacings = new Map<number, HarborFacing>();
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
    this.edgeTiles.clear();
    this.scaledSprites.clear();
  }

  /** Passend verkleinerte Fassung eines Sprites, oder das Original. */
  private scaledSprite(
    image: HTMLImageElement,
    targetHeight: number,
  ): CanvasImageSource {
    // Kaum kleiner als das Original? Dann lohnt der Umweg nicht.
    if (targetHeight >= image.naturalHeight * 0.7) return image;

    const bucket = Math.max(8, 2 ** Math.ceil(Math.log2(targetHeight)));
    const key = image.src + '@' + bucket;
    const cached = this.scaledSprites.get(key);
    if (cached) return cached;

    const h = Math.max(1, Math.round(bucket));
    const w = Math.max(1, Math.round((h * image.naturalWidth) / image.naturalHeight));
    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    const g = el.getContext('2d');
    if (!g) return image;
    // Pixel-Art bleibt beim Vorbacken auf ihrem Raster. Bilineare
    // Glaettung erzeugt sonst weiche Saeume an jedem Sprite.
    g.imageSmoothingEnabled = false;
    g.drawImage(image, 0, 0, w, h);
    this.scaledSprites.set(key, el);
    return el;
  }

  /**
   * Quellzuschnitt und Skalierung einer Terrainvariante, einmalig.
   *
   * crop nur fuer die alten Kacheln: die Atlasvorlage hat einen gemalten
   * Rahmen um jede Kachel, der ohne Beschnitt ein sichtbares Gitter
   * ergibt. Die nahtlosen v2-Kacheln haben keinen - dort wuerde der
   * Beschnitt die Nahtlosigkeit zerstoeren, weil genau die Randpixel
   * wegfielen, die auf den Nachbarn passen.
   */
  private detailTile(
    image: HTMLImageElement,
    size = TERRAIN_PX,
    crop = true,
  ): HTMLCanvasElement {
    const key = image.src + '@' + size + (crop ? '' : 'n');
    const cached = this.detailTiles.get(key);
    if (cached) return cached;

    const baked = document.createElement('canvas');
    baked.width = size;
    baked.height = size;
    const g = baked.getContext('2d');
    if (!g) throw new Error('Detail-Canvas nicht verfuegbar');
    // Die Quellen haben ein logisches 32er-Raster. Naechster Nachbar
    // erhaelt dessen Koernung beim exakten 32 -> 16 Downscale.
    g.imageSmoothingEnabled = false;
    const inset = crop
      ? Math.max(1, Math.round(Math.min(image.naturalWidth, image.naturalHeight) * 0.08))
      : 0;
    g.drawImage(
      image,
      inset, inset,
      image.naturalWidth - inset * 2, image.naturalHeight - inset * 2,
      0, 0, size, size,
    );
    this.detailTiles.set(key, baked);
    return baked;
  }

  /**
   * Randkachel: die Textur des Nachbarn, auf einen Saum an EINER Seite
   * maskiert.
   *
   * Damit entsteht der Uebergang, den das Grafikpaket nicht mitbringt.
   * Bisher bekam eine Grenzkachel einfach den Boden ihres Nachbarn - die
   * Grenze verschob sich damit um eine Kachel, blieb aber eine gerade
   * Treppe. Jetzt greifen beide Boeden ineinander.
   *
   * Die Maske ist bewusst hart (ein Pixel gehoert ganz dem einen oder dem
   * anderen Boden) statt weich: ein weicher Verlauf sieht bei Pixelart
   * nach Weichzeichner aus, eine gestreute Kante nach Verzahnung. Ob ein
   * Pixel uebernommen wird, entscheidet ein Zufallswert gegen seinen
   * Abstand zur Kante - nah an der Kante fast immer, zur Mitte hin fast
   * nie.
   *
   * Vier Streuvarianten je Richtung, ausgewaehlt ueber den Kachelhash:
   * mit nur einer wiederholte sich das Zackenmuster entlang einer langen
   * Kueste sichtbar.
   */
  private edgeTile(
    image: HTMLImageElement,
    dir: number,
    variant: number,
  ): HTMLCanvasElement {
    const key = image.src + '#' + dir + '.' + variant;
    const cached = this.edgeTiles.get(key);
    if (cached) return cached;

    const size = TERRAIN_PX;
    const el = document.createElement('canvas');
    el.width = size;
    el.height = size;
    const g = el.getContext('2d');
    if (!g) throw new Error('Rand-Canvas nicht verfuegbar');
    g.imageSmoothingEnabled = false;
    g.drawImage(image, 0, 0, size, size);

    const img = g.getImageData(0, 0, size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Abstand zur gemeinsamen Kante, 0 = direkt daran.
        const d =
          dir === 0 ? y : dir === 1 ? size - 1 - x : dir === 2 ? size - 1 - y : x;
        const t = d / (size * EDGE_REACH);
        const keep = 1 - t;
        const noise = ((hash2i(EDGE_SEED + variant, x, y) >>> 8) & 1023) / 1023;
        if (keep <= noise) data[(y * size + x) * 4 + 3] = 0;
      }
    }
    g.putImageData(img, 0, 0);
    this.edgeTiles.set(key, el);
    return el;
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
    for (const sh of this.world.state.ships.values()) {
      const g = this.ghosts.get(sh.id);
      if (g) { g.px = sh.x / FP_ONE; g.py = sh.y / FP_ONE; }
      else this.ghosts.set(sh.id, { px: sh.x / FP_ONE, py: sh.y / FP_ONE });
    }
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
      if (!carriers.has(id) && !this.world.state.ships.has(id)) this.ghosts.delete(id);
    }
  }

  draw(alpha: number, hover: BuildPreview | null): void {
    const { ctx, cam } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = UNLOADED_COLOR;
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    this.drawTerrain();
    this.drawRoads();
    this.drawWorldObjects(alpha);
    if (hover) this.drawPreview(hover);
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
    // Zweite Ebene fuer Tiefe und Relief, die ueber die Bodenkacheln
    // gelegt wird. Ohne sie waere das Meer ueberall gleich blau und das
    // Gelaende flach: die Grundfarbe darunter ist bei nahtlosen Kacheln
    // fast vollstaendig verdeckt.
    const shadeImg = g.createImageData(CHUNK_SIZE, CHUNK_SIZE);
    const shadeData = shadeImg.data;
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

        const p = idx << 2;
        if (tile === Tile.Water) {
          const d = waterDepth(h << HEIGHT_SHIFT) / 65536;
          r = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * d;
          g2 = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * d;
          b = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * d;
          // Tiefes Wasser als dunkler Schleier ueber der Wellentextur.
          shadeData[p] = WATER_DEEP[0];
          shadeData[p + 1] = WATER_DEEP[1];
          shadeData[p + 2] = WATER_DEEP[2];
          shadeData[p + 3] = clamp255(d * 255 * DEPTH_SHADE);
        } else {
          // Hoeheres Gelaende heller, Senken dunkler.
          const rel = (h - RELIEF_REF) * RELIEF_GAIN;
          const shade = rel < -RELIEF_MAX ? -RELIEF_MAX : rel > RELIEF_MAX ? RELIEF_MAX : rel;
          const rgb = TILE_RGB[tile as keyof typeof TILE_RGB];
          r = rgb[0] + shade;
          g2 = rgb[1] + shade;
          b = rgb[2] + shade;
          // Dasselbe Relief als Aufhellung bzw. Abdunklung obendrueber.
          const light = shade >= 0 ? 255 : 0;
          shadeData[p] = light;
          shadeData[p + 1] = light;
          shadeData[p + 2] = light;
          shadeData[p + 3] = clamp255(Math.abs(shade) * RELIEF_SHADE);
        }

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

    // Die Bodenkacheln liegen als Detailebene ueber der prozeduralen
    // Grundfarbe. Deckend waeren sie nicht: die Grundfarbe traegt
    // Kontinentform und Tiefenschattierung, die sonst verschwaenden.
    //
    // Wie stark, haengt an der Kachel. Die alten Vorlagen haben sichtbare
    // Kanten und muessen blass bleiben, sonst zeichnet sich ein Gitter
    // ab; die nahtlosen v2-Kacheln vertragen fast volle Deckung - genau
    // daher kommt der Sprung in der Bodenqualitaet.
    g.imageSmoothingEnabled = false;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const sprite = this.groundSprite(tiles, lx, ly, ox, oy);
        const variants = this.assets.terrain[sprite];
        if (variants.length === 0) continue;
        const seamless = SEAMLESS.has(sprite);
        g.globalAlpha = seamless ? DETAIL_ALPHA_SEAMLESS : DETAIL_ALPHA_FRAMED;
        const hash = hash2i(this.textureSeed, ox + lx, oy + ly) >>> 0;
        // Die gelieferten Varianten sind jeweils nur mit sich selbst
        // nahtlos. Varianten zu mischen oder einzelne Kacheln zu drehen
        // verbindet inkompatible Randpixel und macht das Kachelraster
        // sichtbar. Bis ein echter Wang-/Kanten-Satz vorliegt, verwenden
        // nahtlose Flaechen deshalb eine unveraenderte Referenzkachel.
        const variant = seamless ? 0 : hash % variants.length;
        const tile = this.detailTile(variants[variant], TERRAIN_PX, !seamless);
        const orient = seamless ? 0 : (hash >>> 12) & 7;
        if (orient === 0) {
          g.drawImage(tile, lx * TERRAIN_PX, ly * TERRAIN_PX);
        } else {
          g.save();
          g.translate(lx * TERRAIN_PX + TERRAIN_PX / 2, ly * TERRAIN_PX + TERRAIN_PX / 2);
          g.rotate(((orient & 3) * Math.PI) / 2);
          if (orient & 4) g.scale(-1, 1);
          g.drawImage(tile, -TERRAIN_PX / 2, -TERRAIN_PX / 2);
          g.restore();
        }

        // Uebergang zu jedem anders belegten Nachbarn. An Kuesten gilt eine
        // feste Richtung: Sand greift in die Wasserkachel, Wasser aber nie
        // zurueck in den Strand. Zweiseitiges Mischen erzeugte dort die
        // unruhige Folge Strand-Wasser-Strand-Wasser.
        for (let d = 0; d < 4; d++) {
          const [dx, dy] = NEIGHBORS[d];
          const nx = lx + dx;
          const ny = ly + dy;
          // Chunkrand: der Nachbar liegt im Nachbarchunk. Ihn
          // nachzuschlagen waere teuer; eine fehlende Verzahnung faellt an
          // einer einzelnen Kachelreihe nicht auf.
          if (nx < 0 || ny < 0 || nx >= CHUNK_SIZE || ny >= CHUNK_SIZE) continue;
          const other = this.groundSprite(tiles, nx, ny, ox, oy);
          if (other === sprite) continue;
          const coast = sprite === 'water' || other === 'water';
          if (coast && !(sprite === 'water' && other === 'sand')) continue;
          const set = this.assets.terrain[other];
          if (set.length === 0) continue;
          g.globalAlpha = SEAMLESS.has(other) ? DETAIL_ALPHA_SEAMLESS : DETAIL_ALPHA_FRAMED;
          const nh = hash2i(this.textureSeed, ox + nx, oy + ny) >>> 0;
          const otherSeamless = SEAMLESS.has(other);
          const edgeVariant = otherSeamless ? 0 : nh % set.length;
          g.drawImage(
            this.edgeTile(set[edgeVariant], d, (hash >>> (d * 2)) & 3),
            lx * TERRAIN_PX,
            ly * TERRAIN_PX,
          );
        }
      }
    }
    g.globalAlpha = 1;

    // Tiefe und Relief zuletzt, ueber die Kacheln. Weichgezeichnet
    // hochskaliert, damit daraus ein Verlauf wird und kein zweites
    // Kachelraster.
    const shade = document.createElement('canvas');
    shade.width = CHUNK_SIZE;
    shade.height = CHUNK_SIZE;
    const shadeCtx = shade.getContext('2d');
    if (!shadeCtx) throw new Error('Schatten-Canvas nicht verfuegbar');
    shadeCtx.putImageData(shadeImg, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(shade, 0, 0, el.width, el.height);
    g.imageSmoothingEnabled = false;

    return el;
  }

  /**
   * Welcher Boden auf dieser Kachel liegt.
   *
   * Frueher hiess das blendSprite und tauschte an einer Terraingrenze den
   * ganzen Kachelboden gegen den des Nachbarn aus - die Grenze verschob
   * sich damit um eine Kachel, blieb aber eine gerade Treppe. Die
   * Verzahnung macht jetzt edgeTile; hier bleibt nur noch, was den Boden
   * einer Kachel wirklich veraendert.
   */
  private groundSprite(
    tiles: Uint8Array,
    lx: number,
    ly: number,
    ox: number,
    oy: number,
  ): TerrainSprite {
    const own = tiles[(ly << CHUNK_BITS) | lx] as Tile;
    if (own === Tile.Water) return 'water';

    const x = ox + lx;
    const y = oy + ly;
    const state = this.world.state;

    // Unter einem Gebaeude liegt gestampfter Boden. Sonst steht ein Haus
    // mitten auf unberuehrter Wiese, als waere es dort abgestellt worden.
    if (state.buildingAt.size > 0 && state.buildingAt.has(tileKey(x, y))) {
      return 'dirt';
    }

    // Gras direkt an einer Strasse wird zu getretenem Boden. Das laesst
    // Wege in der Landschaft liegen, statt sie darauf zu kleben.
    if (own === Tile.Grass && state.roads.size > 0) {
      for (const [dx, dy] of NEIGHBORS) {
        if (state.roads.has(tileKey(x + dx, y + dy))) return 'dirt';
      }
    }

    return TILE_SPRITE[own];
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

  /**
   * Strassen als durchgehendes Band.
   *
   * Vorher war jede Kachel ein volles Quadrat - eine Strasse las sich als
   * Kette einzelner Platten statt als Weg. Jetzt wird die Flaeche zu den
   * Seiten eingezogen, an denen KEIN Anschluss liegt, und reicht dort bis
   * an den Rand, wo es weitergeht. Ein gerader Weg wird damit zu einem
   * schmalen Band, eine Kreuzung bleibt breit, und ein Ende laeuft aus.
   *
   * Gebaeude zaehlen als Anschluss - sonst klaffte vor jeder Tuer eine Luecke.
   */
  /**
   * Strassen.
   *
   * Eine Strasse ist eine volle Kachel Pflaster, kein eingezogenes Band
   * mehr. Das Band sollte Wege verbinden, machte die Textur aber
   * matschig: sie wurde auf eine schmalere Flaeche gestaucht und wirkte
   * dadurch je nach Anschluss anders. Eine durchgehende Kachel ist
   * schlicht das, was ein gepflasterter Weg ist - und die Nachbarkacheln
   * setzen sie fort.
   *
   * Wo drei oder vier Wege zusammentreffen, kommt eine der
   * Kreuzungsvorlagen zum Einsatz; die zeigt die Fugen sternfoermig statt
   * in eine Richtung.
   */
  private drawRoads(): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const v = cam.visibleTiles();
    const plain = this.assets.terrain.road.slice(0, 4);
    const junctions = this.assets.terrain.road.slice(4);
    const state = this.world.state;

    const connects = (x: number, y: number): boolean => {
      const key = tileKey(x, y);
      return state.roads.has(key) || state.buildingAt.has(key);
    };

    for (const key of state.roads) {
      const [x, y] = parseKey(key);
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;

      let links = 0;
      for (const [dx, dy] of NEIGHBORS) if (connects(x + dx, y + dy)) links++;

      const hash = hash2i(this.textureSeed ^ 0x218bc1, x, y) >>> 0;
      const set = links >= 3 && junctions.length > 0 ? junctions : plain;
      const sx = Math.round(cam.worldToScreenX(x));
      const sy = Math.round(cam.worldToScreenY(y));
      const sx1 = Math.round(cam.worldToScreenX(x + 1));
      const sy1 = Math.round(cam.worldToScreenY(y + 1));

      if (set.length === 0) {
        ctx.fillStyle = ROAD_COLOR;
        ctx.fillRect(sx, sy, sx1 - sx, sy1 - sy);
        continue;
      }
      // Kanten auf ganze Pixel runden wie beim Terrain, sonst blitzt
      // zwischen zwei Strassenkacheln der Untergrund durch.
      // 32 statt der 8 Pixel des Chunk-Caches: Strassen werden direkt auf
      // den Bildschirm gezeichnet, nicht in die verkleinerte Chunkkachel.
      ctx.drawImage(
        this.detailTile(set[hash % set.length], ROAD_PX),
        sx, sy, sx1 - sx, sy1 - sy,
      );
      void z;
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

    for (const sh of this.world.state.ships.values()) {
      const shx = sh.x / FP_ONE;
      const shy = sh.y / FP_ONE;
      if (shx < v.x0 - 2 || shx > v.x1 + 2 || shy < v.y0 - 2 || shy > v.y1 + 2) continue;
      const g = this.ghosts.get(sh.id);
      objects.push({
        kind: 'ship',
        x: g ? g.px + (shx - g.px) * alpha : shx,
        y: g ? g.py + (shy - g.py) * alpha : shy,
        ship: sh,
      });
    }

    for (const c of this.world.state.carriers.values()) {
      const cx = c.x / FP_ONE;
      const cy = c.y / FP_ONE;
      if (cx < v.x0 - 1 || cx > v.x1 + 1 || cy < v.y0 - 2 || cy > v.y1 + 1) continue;
      // Wer auf einer Gebaeudekachel steht, ist drinnen und wird nicht
      // gezeichnet. Die Sprites sind gut zwei Kacheln hoch, eine Figur im
      // Grundriss ueberlappt sie also immer - egal wie herum sortiert
      // wird, sie sah aus, als staende sie auf dem Dach.
      if (this.world.state.buildingAt.has(tileKey(Math.round(cx), Math.round(cy)))) {
        continue;
      }
      const ghost = this.ghosts.get(c.id);
      objects.push({
        kind: 'carrier',
        x: ghost ? ghost.px + (cx - ghost.px) * alpha : cx,
        y: ghost ? ghost.py + (cy - ghost.py) * alpha : cy,
        carrier: c,
      });
    }

    // Nach dem FUSSPUNKT sortieren, nicht nach der Ankerzeile.
    //
    // Ein Gebaeude auf (x,y) steht mit seiner Unterkante auf y+footprint,
    // ein Traeger auf y+1. Nach der Ankerzeile sortiert landete ein
    // Traeger, der IM Gebaeude steht, davor - er stand auf dem Dach.
    // Nach dem Fusspunkt sortiert liegt er dahinter, und sobald er suedlich
    // heraustritt, davor.
    objects.sort((a, b) =>
      (footY(a) - footY(b)) || (a.x - b.x) || sceneOrder(a.kind) - sceneOrder(b.kind));

    for (const object of objects) {
      switch (object.kind) {
        case 'cliff':
          this.drawCliff(object.image, object.x, object.y, object.dir);
          break;
        case 'scatter':
          this.drawBottomCentered(object.image, object.x + 0.5, object.y + 1, cam.zoom * 0.85);
          break;
        case 'tree':
          this.drawBottomCentered(object.image, object.x + 0.5, object.y + 1, cam.zoom * 2.65);
          break;
        case 'resource':
          this.drawBottomCentered(object.image, object.x + 0.5, object.y + 0.95, cam.zoom * 1.35);
          break;
        case 'building':
          this.drawBuilding(object.building);
          break;
        case 'ship':
          this.drawShip(object.ship, object.x, object.y);
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
    const cliffs = this.assets.shore.cliff;
    const scatter = this.cam.zoom >= SCATTER_MIN_ZOOM;
    /**
     * Baumdichte nach Zoom.
     *
     * Bei Uebersichtszoom ist ein Baum achtzehn Pixel gross und von seinem
     * Nachbarn nicht zu unterscheiden - jeder einzelne kostet trotzdem
     * einen Draw-Call. Ausgeduennt bleibt der Waldeindruck erhalten, weil
     * der dunkle Waldboden darunter ihn ohnehin traegt.
     */
    const treeStep = this.cam.zoom >= 12 ? 1 : 3;
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

            // Uferkante zu JEDER Seite, an der Wasser liegt.
            //
            // Das Sprite zeigt eine Felswand unter einer Grasoberkante und
            // ist damit von Haus aus nach Sueden gerichtet. Fuer die
            // uebrigen Seiten wird es gedreht - in der weitgehend
            // senkrechten Aufsicht liest sich das als umlaufender Fels-
            // saum, und eine Kante ohne Saum faellt staerker auf als eine
            // gedrehte.
            if (cliffs.length > 0 && tile !== Tile.Water && tile !== Tile.Sand) {
              for (let d = 0; d < 4; d++) {
                const [dx, dy] = NEIGHBORS[d];
                const nx = lx + dx;
                const ny = ly + dy;
                if (nx < 0 || ny < 0 || nx >= CHUNK_SIZE || ny >= CHUNK_SIZE) continue;
                if ((chunk.tiles[(ny << CHUNK_BITS) | nx] as Tile) !== Tile.Water) continue;
                const h = hash2i(seed ^ CLIFF_SEED ^ (d * 0x9e37), x, y) >>> 0;
                objects.push({
                  kind: 'cliff', x, y, dir: d, image: cliffs[h % cliffs.length],
                });
              }
            }

            let image: HTMLImageElement | undefined;
            let kind: 'tree' | 'resource' | 'scatter';

            if (tile === Tile.Grass) {
              if (!scatter) continue;
              // Wiese bekommt sparsam Blumen und Buesche. Sparsam ist hier
              // Absicht: dicht gestreut liest sich Gras nicht mehr als
              // freie Flaeche, auf der man bauen kann.
              const hash = hash2i(seed ^ SCATTER_SEED, x, y) >>> 0;
              if ((hash & 15) !== 0) continue;
              const group = (hash >>> 4) & 3
                ? this.assets.scatter.bushes
                : this.assets.scatter.flowers;
              if (group.length === 0) continue;
              image = group[(hash >>> 8) % group.length];
              kind = 'scatter';
            } else if (tile === Tile.Forest) {
              if (trees.length === 0) continue;
              const hash = hash2i(seed ^ TREE_SEED, x, y) >>> 0;
              if (treeStep > 1 && hash % treeStep !== 0) continue;
              // Grobe 4x4-Cluster bestimmen die lokale Dichte, der Tile-Hash
              // verteilt darin einzelne Baeume. So entstehen Lichtungen und
              // Baumgruppen, statt dass jede Waldkachel dieselbe visuelle
              // Bedeutung bekommt. Beides bleibt rein seed-abhaengig.
              const cluster = hash2i(seed ^ (TREE_SEED + 0x45d9), x >> 2, y >> 2) >>> 0;
              const threshold = 12 + ((cluster & 255) >>> 3);
              if ((hash & 255) > threshold) continue;
              // Neben einer Strasse keine Baeume. Ihre Kronen ragen zwei
              // Kacheln nach oben und deckten den Weg sonst komplett zu -
              // die Strasse verschwand im Wald.
              if (hasOccupants && nearRoad(state, x, y)) continue;
              // Jede Waldkachel bekommt einen Baum - Wald soll als
              // geschlossene Flaeche lesen, nicht als Streuobstwiese.
              // Der Versatz innerhalb der Kachel nimmt dem Ganzen das
              // Rastermuster, das bei voller Dichte sonst auffiele.
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

            // Versatz innerhalb der Kachel, damit die Objekte nicht auf
            // einem sichtbaren Gitter stehen.
            const jx = (((hash2i(seed ^ 0x51ab, x, y) >>> 0) & 255) / 255 - 0.5) * 0.55;
            const jy = (((hash2i(seed ^ 0x9d31, x, y) >>> 0) & 255) / 255 - 0.5) * 0.4;
            objects.push({ kind, x: x + jx, y: y + jy, image });
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
    this.ctx.drawImage(this.scaledSprite(image, height), x, y, width, height);
  }

  /**
   * Zeichnet ein Sprite passend zu seiner Grundflaeche.
   *
   * Die BREITE richtet sich nach der belegten Flaeche, die Hoehe ergibt
   * sich aus dem Seitenverhaeltnis. In der 3/4-Ansicht ist das richtig
   * herum: ein Dach darf nach oben ueber die Grundflaeche hinausragen -
   * dort liegt aus Sicht des Betrachters ohnehin "hinter" dem Gebaeude -,
   * aber nicht seitlich, sonst deckt es Nachbarkacheln zu, auf denen man
   * bauen kann.
   */
  private drawOnFootprint(
    image: HTMLImageElement,
    x: number,
    y: number,
    footprint: number,
    mirrored = false,
    scale = 1,
  ): void {
    const z = this.cam.zoom;
    // Etwas breiter als die Grundflaeche: sonst wirkt das Gebaeude
    // eingeschnuert, weil die Sprites einen transparenten Rand haben.
    const width = footprint * z * SPRITE_OVERHANG * scale;
    const height = width / (image.naturalWidth / image.naturalHeight);
    const sx = this.cam.worldToScreenX(x + footprint / 2) - width / 2;
    const sy = this.cam.worldToScreenY(y + footprint) - height;
    if (!mirrored) {
      this.ctx.drawImage(image, sx, sy, width, height);
      return;
    }
    const { ctx } = this;
    ctx.save();
    ctx.translate(sx + width, sy);
    ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0, width, height);
    ctx.restore();
  }

  /**
   * Hafen zum Wasser hin ausrichten.
   *
   * Der alte grosse Hafen enthielt eine opake Wasserplatte und ist deshalb
   * nicht mehr im Laufzeitmanifest. Bis die vier neuen Richtungs-Sprites
   * vorliegen, setzt sich seine Ausbaustufe aus dem sauberen Richtungssteg
   * und einem Umschlagplatz auf der Landseite zusammen. Beides bleibt auf
   * transparentem Grund und funktioniert an allen vier Ufern.
   */
  private drawHarbor(image: HTMLImageElement | null, b: Building, foot: number): void {
    const f = this.harborFacing(b, foot);
    const view = this.assets.smallHarbor[FACING_NAME[f.dir]];
    const scale = BUILDING_SPECS[b.type].spriteScale;

    if (view) {
      this.drawOnFootprint(view, b.x + f.shiftX, b.y + f.shiftY, foot, false, scale);
      if (b.type === BuildingType.Harbor) {
        const depot = this.assets.buildings[BuildingType.Depot]?.[
          (b.id >>> 0) % (this.assets.buildings[BuildingType.Depot]?.length || 1)
        ];
        if (depot) {
          // Gegen die Wasserrichtung versetzt: Lagerteil steht an Land,
          // der Richtungssteg bleibt davor sichtbar.
          this.drawOnFootprint(
            depot,
            b.x - f.shiftX * 0.72,
            b.y - f.shiftY * 0.72,
            foot,
            false,
            scale * 0.72,
          );
        }
      }
      return;
    }

    // Robuster Fallback fuer unvollstaendige Asset-Builds.
    if (image) this.drawOnFootprint(image, b.x + f.shiftX, b.y + f.shiftY, foot, f.mirrored, scale);
  }

  /**
   * Wie der Hafen zum Wasser steht: wohin er rueckt und wie herum sein
   * Steg zeigt.
   *
   * Beides ist nicht dasselbe, und der Grund liegt im Sprite. Steg, Boot
   * und ein Stueck Wasser sind vorne LINKS eingebrannt. Spiegeln bedient
   * damit Wasser im Osten, ungespiegelt Wasser im Westen oder Sueden -
   * aber fuer Wasser im NORDEN gibt es keine Darstellung: drehen wuerde
   * das Dach auf den Kopf stellen. Bis es gedrehte Hafensprites gibt,
   * wird der Steg deshalb nur nach Sueden, Osten oder Westen gerichtet.
   * An einer Nordkueste zeigt er dann laengs am Ufer entlang statt vom
   * Land weg - deutlich unauffaelliger als ein eingebranntes Stueck
   * Wasser mitten auf der Wiese.
   *
   * Der Versatz folgt weiterhin dem echten Schwerpunkt des Wassers, also
   * auch nach Norden. Das Ergebnis haengt nur am Gelaende und wird
   * deshalb pro Gebaeude gemerkt.
   */
  private harborFacing(b: Building, foot: number): HarborFacing {
    const cached = this.harborFacings.get(b.id);
    if (cached) return cached;

    const cx = b.x + foot / 2 - 0.5;
    const cy = b.y + foot / 2 - 0.5;
    let sx = 0;
    let sy = 0;
    // Gewicht je Himmelsrichtung, Reihenfolge wie NEIGHBORS (N, O, S, W).
    const side = [0, 0, 0, 0];
    for (let y = b.y - HARBOR_SCAN; y < b.y + foot + HARBOR_SCAN; y++) {
      for (let x = b.x - HARBOR_SCAN; x < b.x + foot + HARBOR_SCAN; x++) {
        if (getTile(this.world, x, y) !== Tile.Water) continue;
        // Nahes Wasser zaehlt staerker als fernes.
        const dx = x - cx;
        const dy = y - cy;
        const w = 1 / (1 + dx * dx + dy * dy);
        sx += dx * w;
        sy += dy * w;
        if (dx > 0) side[1] += dx * w;
        if (dx < 0) side[3] -= dx * w;
        if (dy > 0) side[2] += dy * w;
        if (dy < 0) side[0] -= dy * w;
      }
    }

    // Bei Gleichstand gewinnt der kleinere Index - sonst haengt das Bild
    // an Rundungsfehlern und flackert beim Neuzeichnen.
    let dir = 0;
    for (const d of [1, 2, 3]) if (side[d] > side[dir]) dir = d;
    // Fuer den grossen Hafen zusaetzlich die beste DARSTELLBARE Richtung.
    let best = 2;
    for (const d of [1, 3]) if (side[d] > side[best]) best = d;

    const norm = Math.hypot(sx, sy) || 1;
    const facing: HarborFacing = {
      dir,
      // Gespiegelt genau dann, wenn der Steg nach Osten zeigen soll.
      mirrored: best === 1,
      shiftX: (sx / norm) * HARBOR_DOCK_SHIFT,
      shiftY: (sy / norm) * HARBOR_DOCK_SHIFT,
    };
    this.harborFacings.set(b.id, facing);
    return facing;
  }

  private drawBuilding(b: Building): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const sprites = this.assets.buildings[b.type] ?? [];
    const image = sprites.length > 0 ? sprites[(b.id >>> 0) % sprites.length] : null;
    const sx = cam.worldToScreenX(b.x);
    const sy = cam.worldToScreenY(b.y);

    const spec = BUILDING_SPECS[b.type];
    const foot = spec.footprint;
    if (spec.isPort && (image || this.assets.smallHarbor.down)) {
      this.drawHarbor(image, b, foot);
    } else if (image) {
      this.drawOnFootprint(image, b.x, b.y, foot, false, spec.spriteScale);
    } else {
      ctx.fillStyle = BUILDING_COLOR[b.type];
      ctx.fillRect(sx, sy, z * foot, z * foot);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, z * foot - 1, z * foot - 1);
    }

    if (z < 10) return;

    // Produktionsfortschritt und Waren bleiben als knappe Status-Overlays
    // erhalten; sie liegen an der logischen Kachel statt auf dem Dach.
    if (spec.workTicks > 0 && b.progress >= 0) {
      const frac = b.progress / spec.workTicks;
      const fw = z * foot;
      ctx.fillStyle = 'rgba(16,24,29,0.78)';
      ctx.fillRect(sx, sy + fw - 3, fw, 3);
      ctx.fillStyle = '#f4d35e';
      ctx.fillRect(sx, sy + fw - 3, fw * frac, 3);
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

  /**
   * Uferkante an einer der vier Seiten.
   *
   * NEIGHBORS ist (N, O, S, W). Das Sprite ist nach Sueden gerichtet, also
   * wird es um die Differenz zu Sueden gedreht. Es ragt bewusst ueber die
   * Kachel hinaus ins Wasser - sonst endete die Felswand an der
   * Kachelkante statt einzutauchen.
   */
  private drawCliff(image: HTMLImageElement, x: number, y: number, dir: number): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const size = z * 1.5;
    const turns = (dir - 2 + 4) % 4; // 2 = Sueden = ungedreht
    const [dx, dy] = NEIGHBORS[dir];

    ctx.save();
    // Mittelpunkt leicht zur Wasserseite verschieben, damit der Fuss der
    // Wand im Wasser steht.
    ctx.translate(
      cam.worldToScreenX(x + 0.5 + dx * 0.22),
      cam.worldToScreenY(y + 0.5 + dy * 0.22),
    );
    if (turns !== 0) ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(this.scaledSprite(image, size), -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  private drawShip(sh: Ship, x: number, y: number): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const image = this.assets.ship[this.headingOf(sh.path, sh.pathIdx, x, y)];
    if (image) {
      // Schiffe liegen IM Wasser, nicht darauf: Mittelpunkt als Anker
      // statt der Unterkante wie bei Gebaeuden und Figuren.
      const h = z * 1.9;
      const w = h * (image.naturalWidth / image.naturalHeight);
      ctx.drawImage(
        this.scaledSprite(image, h),
        cam.worldToScreenX(x + 0.5) - w / 2,
        cam.worldToScreenY(y + 0.5) - h / 2,
        w, h,
      );
    } else {
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(cam.worldToScreenX(x) + z * 0.2, cam.worldToScreenY(y) + z * 0.3,
                   z * 0.6, z * 0.4);
    }
    if (sh.carrying >= 0 && z >= 8) {
      ctx.fillStyle = GOOD_COLOR[sh.carrying as keyof typeof GOOD_COLOR];
      ctx.beginPath();
      ctx.arc(cam.worldToScreenX(x + 0.5), cam.worldToScreenY(y) - z * 0.35,
              Math.max(2, z * 0.14), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Blickrichtung aus dem naechsten Wegpunkt. */
  private headingOf(
    path: number[],
    idx: number,
    x: number,
    y: number,
  ): CarrierDirection {
    const tx = path[idx * 2];
    const ty = path[idx * 2 + 1];
    if (tx === undefined || ty === undefined) return 'down';
    const dx = tx - x;
    const dy = ty - y;
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
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
      this.drawBottomCentered(image, x + 0.5, y + 0.9, z * CARRIER_HEIGHT);
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

  /**
   * Bauvorschau.
   *
   * Zeigt die belegte Flaeche, ob dort gebaut werden darf, und - bei einer
   * Bauart - einen halbdurchsichtigen Geist des Gebaeudes. Vorher gab es
   * nur einen weissen Kachelrahmen; man sah weder wieviel Platz ein
   * Gebaeude braucht noch ob die Stelle taugt, und erfuhr es erst, wenn
   * beim Tippen nichts passierte.
   */
  private drawPreview(p: BuildPreview): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const n = p.footprint;
    const sx = cam.worldToScreenX(p.x);
    const sy = cam.worldToScreenY(p.y);

    if (p.image) {
      ctx.globalAlpha = 0.55;
      this.drawOnFootprint(p.image, p.x, p.y, n);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = p.valid ? 'rgba(127,209,165,0.20)' : 'rgba(217,139,139,0.24)';
    ctx.fillRect(sx, sy, z * n, z * n);
    ctx.strokeStyle = p.valid ? 'rgba(127,209,165,0.95)' : 'rgba(217,139,139,0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, z * n - 2, z * n - 2);

    // Eingerastet: kleiner Hinweis, dass die Vorschau nicht genau unter
    // dem Zeiger sitzt.
    if (p.snapped) {
      ctx.fillStyle = 'rgba(127,209,165,0.95)';
      ctx.beginPath();
      ctx.arc(sx + (z * n) / 2, sy + (z * n) / 2, Math.max(2, z * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Unterkante eines Objekts in Weltkoordinaten. */
/** Liegt an dieser Kachel oder einer ihrer vier Nachbarn eine Strasse? */
function nearRoad(state: World['state'], x: number, y: number): boolean {
  if (state.roads.has(tileKey(x, y))) return true;
  for (const [dx, dy] of NEIGHBORS) {
    if (state.roads.has(tileKey(x + dx, y + dy))) return true;
  }
  return false;
}

const footY = (o: SceneObject): number =>
  o.kind === 'building' ? o.y + BUILDING_SPECS[o.building.type].footprint : o.y + 1;

const sceneOrder = (kind: SceneObject['kind']): number => {
  switch (kind) {
    // Uferkanten zuerst: sie liegen im Gelaende, alles andere steht darauf.
    case 'cliff': return -1;
    case 'ship': return 1;
    case 'scatter': return 0;
    case 'tree': return 0;
    case 'resource': return 1;
    case 'building': return 2;
    case 'carrier': return 3;
  }
};

export type { Carrier };
