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
import { CHUNK_BITS, CHUNK_SIZE, NEIGHBORS, chunkKey, parseKey, tileKey } from '../sim/coords';
import { hash2i } from '../sim/hash';
import { FP_ONE } from '../sim/fixed';
import { buildingIdAt, hasRoad, type World } from '../sim/state';
import { Tile, waterDepth } from '../sim/terrain';
import { BUILDING_SPECS, GOOD_COUNT, type Building, type Carrier } from '../sim/types';
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
/** Detailaufloesung des statischen Terrain-Chunk-Canvas. */
const TERRAIN_PX = 8;
/** 96 Chunks entsprechen rund 96 MiB Canvas-Pixeln statt ueber 500 MiB. */
const MAX_RENDER_CHUNKS = 96;
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
 * Knapp ueber 1, seit die Sprites aus dem v0.2-Paket kommen: die sind eng
 * auf das Gebaeude zugeschnitten und bringen kein breites Bodenstueck mehr
 * mit. Ihr Seitenverhaeltnis liegt bei etwa 0.73 statt 1.3 - die HOEHE
 * ergibt sich daraus von selbst und faellt entsprechend gross aus, was in
 * der 3/4-Ansicht richtig ist: das Dach ragt nach oben ueber die
 * Grundflaeche, dort liegt aus Sicht des Betrachters ohnehin "hinter" dem
 * Gebaeude.
 */
const SPRITE_OVERHANG = 1.12;
const TREE_SEED = 0x4f2a19c3 | 0;
const SCATTER_SEED = 0x2c8f5b71 | 0;
const CLIFF_SEED = 0x7b3d19a5 | 0;
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
const TILE_SPRITE: Record<Tile, TerrainSprite> = {
  [Tile.Water]: 'water',
  [Tile.Sand]: 'sand',
  [Tile.Grass]: 'grass',
  [Tile.Forest]: 'forest_ground',
  [Tile.Stone]: 'dirt',
  [Tile.Mountain]: 'snow',
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

interface Ghost {
  px: number;
  py: number;
}

type SceneObject =
  | { kind: 'cliff'; x: number; y: number; image: HTMLImageElement }
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
  private detailTiles = new Map<HTMLImageElement, HTMLCanvasElement>();
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
    g.imageSmoothingEnabled = true;
    g.drawImage(image, 0, 0, w, h);
    this.scaledSprites.set(key, el);
    return el;
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
        const blend = this.blendSprite(tiles, lx, ly, ox, oy);
        const variants = blend
          ? this.assets.terrain[blend]
          : this.terrainImages(tiles[(ly << CHUNK_BITS) | lx] as Tile);
        if (variants.length === 0) continue;
        const hash = hash2i(this.textureSeed, ox + lx, oy + ly) >>> 0;
        const tile = this.detailTile(variants[hash % variants.length]);
        // Zusaetzlich spiegeln und drehen. Aus sechs Grasvarianten werden
        // so 48 sichtbar verschiedene Kacheln - ohne eine einzige neue
        // Grafik. Ohne das wiederholt sich der Boden erkennbar, gerade auf
        // grossen Wiesen-, Sand- und Wasserflaechen.
        const orient = (hash >>> 12) & 7;
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
      }
    }
    g.globalAlpha = 1;
    return el;
  }

  private terrainImages(tile: Tile): HTMLImageElement[] {
    return this.assets.terrain[TILE_SPRITE[tile]];
  }

  /**
   * Boden am Rand einer anderen Terrainart.
   *
   * Gras direkt neben Wald bekommt den Waldboden, Gras neben Fels den
   * Erdboden. Das ist kein echter Uebergangskachelsatz - dafuer muesste
   * das Grafikpaket Kanten mitbringen -, nimmt der Grenze aber den harten
   * Farbsprung und laesst Waldraender bewachsen wirken.
   */
  private blendSprite(
    tiles: Uint8Array,
    lx: number,
    ly: number,
    ox: number,
    oy: number,
  ): TerrainSprite | null {
    if (tiles[(ly << CHUNK_BITS) | lx] !== Tile.Grass) return null;

    // Gras direkt an einer Strasse wird zu getretenem Boden. Das laesst
    // Wege in der Landschaft liegen, statt sie darauf zu kleben.
    const roads = this.world.state.roads;
    if (roads.size > 0) {
      for (const [dx, dy] of NEIGHBORS) {
        if (roads.has(tileKey(ox + lx + dx, oy + ly + dy))) return 'dirt';
      }
    }

    let forest = 0;
    let rocky = 0;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = lx + dx;
      const ny = ly + dy;
      // Chunkrand: der Nachbar liegt im Nachbarchunk. Ihn nachzuschlagen
      // waere teuer; die fehlende Mischung faellt an einer einzelnen
      // Kachelreihe nicht auf.
      if (nx < 0 || ny < 0 || nx >= CHUNK_SIZE || ny >= CHUNK_SIZE) continue;
      const t = tiles[(ny << CHUNK_BITS) | nx];
      if (t === Tile.Forest) forest++;
      else if (t === Tile.Stone || t === Tile.Mountain) rocky++;
    }
    if (forest >= 2) return 'forest_ground';
    if (rocky >= 2) return 'dirt';
    return null;
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
  private drawRoads(): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const v = cam.visibleTiles();
    const sprites = this.assets.terrain.road;
    const state = this.world.state;
    const inset = Math.max(0.5, z * 0.22);

    const connects = (x: number, y: number): boolean => {
      const key = tileKey(x, y);
      return state.roads.has(key) || state.buildingAt.has(key);
    };

    for (const key of state.roads) {
      const [x, y] = parseKey(key);
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;

      const left = connects(x - 1, y) ? 0 : inset;
      const right = connects(x + 1, y) ? 0 : inset;
      const up = connects(x, y - 1) ? 0 : inset;
      const down = connects(x, y + 1) ? 0 : inset;

      const sx = cam.worldToScreenX(x) + left;
      const sy = cam.worldToScreenY(y) + up;
      const w = z - left - right;
      const h = z - up - down;

      ctx.fillStyle = ROAD_COLOR;
      ctx.fillRect(sx, sy, w, h);
      if (sprites.length === 0 || z < 4) continue;

      const image = this.detailTile(
        sprites[(hash2i(this.textureSeed ^ 0x218bc1, x, y) >>> 0) % sprites.length],
      );
      // Das Sprite wird immer auf die VOLLE Kachel gezeichnet und nur auf
      // das Band beschnitten. Vorher wurde stattdessen ein Teilausschnitt
      // der Vorlage auf das Band gestreckt - dadurch erschien die Textur
      // je nach Anschluss in anderem Massstab, was die Strasse
      // verwaschen wirken liess.
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, w, h);
      ctx.clip();
      ctx.globalAlpha = 0.92;
      ctx.drawImage(image, cam.worldToScreenX(x), cam.worldToScreenY(y), z, z);
      ctx.restore();
      ctx.globalAlpha = 1;
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
        case 'cliff':
          // Etwas ueber die Kachel hinaus nach unten, damit die Felswand in
          // das Wasser darunter hineinragt statt an der Kante zu enden.
          this.drawBottomCentered(object.image, object.x + 0.5, object.y + 1.45, cam.zoom * 1.5);
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

            // Uferkante: Land, dessen Suedseite Wasser ist. In der
            // 3/4-Ansicht schaut man genau auf diese Kante - nach Norden,
            // Osten oder Westen waere sie vom Gelaende verdeckt.
            if (cliffs.length > 0 && tile !== Tile.Water && tile !== Tile.Sand) {
              const below = ly + 1 <= CHUNK_SIZE - 1
                ? (chunk.tiles[((ly + 1) << CHUNK_BITS) | lx] as Tile)
                : undefined;
              if (below === Tile.Water) {
                const h = hash2i(seed ^ CLIFF_SEED, x, y) >>> 0;
                objects.push({ kind: 'cliff', x, y, image: cliffs[h % cliffs.length] });
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
  ): void {
    const z = this.cam.zoom;
    // Etwas breiter als die Grundflaeche: sonst wirkt das Gebaeude
    // eingeschnuert, weil die Sprites einen transparenten Rand haben.
    const width = footprint * z * SPRITE_OVERHANG;
    const height = width / (image.naturalWidth / image.naturalHeight);
    const sx = this.cam.worldToScreenX(x + footprint / 2) - width / 2;
    const sy = this.cam.worldToScreenY(y + footprint) - height;
    this.ctx.drawImage(image, sx, sy, width, height);
  }

  private drawBuilding(b: Building): void {
    const { ctx, cam } = this;
    const z = cam.zoom;
    const sprites = this.assets.buildings[b.type] ?? [];
    const image = sprites.length > 0 ? sprites[(b.id >>> 0) % sprites.length] : null;
    const sx = cam.worldToScreenX(b.x);
    const sy = cam.worldToScreenY(b.y);

    const foot = BUILDING_SPECS[b.type].footprint;
    if (image) {
      this.drawOnFootprint(image, b.x, b.y, foot);
    } else {
      ctx.fillStyle = BUILDING_COLOR[b.type];
      ctx.fillRect(sx, sy, z * foot, z * foot);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, z * foot - 1, z * foot - 1);
    }

    const spec = BUILDING_SPECS[b.type];

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

const sceneOrder = (kind: SceneObject['kind']): number => {
  switch (kind) {
    // Uferkanten zuerst: sie liegen im Gelaende, alles andere steht darauf.
    case 'cliff': return -1;
    case 'scatter': return 0;
    case 'tree': return 0;
    case 'resource': return 1;
    case 'building': return 2;
    case 'carrier': return 3;
  }
};

export type { Carrier };
