/**
 * Einstiegspunkt und Spielschleife.
 *
 * Der Kern ist der Akkumulator: die Simulation laeuft mit exakt TICK_HZ,
 * unabhaengig davon, ob der Browser 30, 60 oder 144 Bilder pro Sekunde
 * schafft. Das Rendering interpoliert nur zwischen zwei Tick-Zustaenden -
 * es schreibt nie zurueck.
 *
 * Diese Schleife ist auch schon die Form, die M5 braucht: dort kommen die
 * Commands nicht mehr direkt aus der Eingabe, sondern mit ein paar Ticks
 * Verzoegerung aus dem Netz.
 */

import { parseKey } from '../sim/coords';
import { hashWorldHex, serialize, deserialize } from '../sim/serialize';
import { createWorld, getTile, stockSummary, type World } from '../sim/state';
import { TILE_NAMES, Tile } from '../sim/terrain';
import { BuildingType } from '../sim/types';
import { TICK_MS, step } from '../sim/tick';
import { Camera } from './camera';
import { Hud } from './hud';
import { Input, Mode } from './input';
import { clearSnapshot, loadSnapshot, saveSnapshot } from './persist';
import { Renderer } from './renderer';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const cam = new Camera();

let world: World = createWorld(seedFromUrl());
let renderer = new Renderer(canvas, world, cam);

const input = new Input(canvas, cam);
const hud = new Hud(
  (m) => input.setMode(m),
  () => void newWorld((Math.random() * 0x7fffffff) | 0),
  () => void resetSave(),
);
input.onModeChange = (m) => hud.setMode(m);
input.setMode(Mode.Pan);

// --- Aufsetzen ---------------------------------------------------------

function seedFromUrl(): number {
  const m = /seed=(-?\d+)/.exec(location.hash);
  // Math.random ist hier unbedenklich: der Seed wird EINMAL gezogen und
  // danach Teil des Weltzustands. In src/sim waere er verboten.
  return m ? Number(m[1]) | 0 : (Math.random() * 0x7fffffff) | 0;
}

function attachWorld(next: World): void {
  world = next;
  renderer = new Renderer(canvas, world, cam);
  location.hash = 'seed=' + world.state.seed;
}

/**
 * Setzt die Kamera auf den naechstgelegenen bebaubaren Fleck.
 * Scannt in Ringen nach aussen, damit der Startpunkt wirklich der naechste
 * ist - eine grobe Stichprobe pro Radius kann Landzungen komplett verfehlen.
 */
function centerOnLand(): void {
  const isLand = (x: number, y: number): boolean => {
    const t = getTile(world, x, y);
    return t === Tile.Grass || t === Tile.Forest;
  };

  if (isLand(0, 0)) return;

  for (let r = 2; r <= 600; r += 2) {
    for (let i = -r; i <= r; i += 2) {
      for (const [x, y] of [[i, -r], [i, r], [-r, i], [r, i]] as const) {
        if (!isLand(x, y)) continue;
        cam.jumpTo(x, y);
        return;
      }
    }
  }
}

async function newWorld(seed: number): Promise<void> {
  attachWorld(createWorld(seed));
  centerOnLand();
  await clearSnapshot();
  saveState = 'neue Welt';
}

async function resetSave(): Promise<void> {
  await clearSnapshot();
  await newWorld(world.state.seed);
}

/**
 * Kamera auf die eigene Siedlung setzen - das erste Lager, sonst das erste
 * Gebaeude ueberhaupt. Die Kameraposition steht bewusst nicht im Spielstand
 * (sie ist Client-Zustand, kein Weltzustand), deshalb muss sie beim Laden
 * neu bestimmt werden. Ohne das startet man auf (0,0) und schaut auf Ozean,
 * waehrend die Siedlung ausserhalb des Bildes liegt.
 */
function centerOnSettlement(): boolean {
  let home: { x: number; y: number } | null = null;
  let homeId = Infinity;
  for (const b of world.state.buildings.values()) {
    const preferred = b.type === BuildingType.Storehouse;
    if (home !== null && !preferred) continue;
    if (preferred && b.id > homeId) continue;
    home = { x: b.x, y: b.y };
    if (preferred) homeId = b.id;
  }
  if (home === null) return false;
  cam.jumpTo(home.x, home.y);
  return true;
}

async function boot(): Promise<void> {
  try {
    const snap = await loadSnapshot();
    if (snap) {
      attachWorld(deserialize(snap));
      saveState = 'geladen (Tick ' + snap.tick + ')';
      if (!centerOnSettlement()) centerOnLand();
    } else {
      centerOnLand();
    }
  } catch (err) {
    console.warn('Spielstand konnte nicht geladen werden:', err);
    centerOnLand();
  }
  requestAnimationFrame(frame);
}

// --- Schleife ----------------------------------------------------------

let acc = 0;
let last = performance.now();
let fps = 0;
let hashCache = '';
let lastHashAt = 0;
let lastSaveAt = 0;
let saveState = 'noch nicht gespeichert';

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  cam.setViewport(canvas.width / dpr, canvas.height / dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(now: number): void {
  let dt = now - last;
  last = now;
  // Nach einem Tab-Wechsel nicht hunderte Ticks nachholen.
  if (dt > 250) dt = 250;
  // Zeitstempel koennen zurueckspringen (Debug-Aufrufe, Uhrensprung).
  // Ohne Klemme liefe der Akkumulator rueckwaerts.
  if (dt < 0) dt = 0;
  fps = fps === 0 ? 1000 / Math.max(dt, 1) : fps * 0.9 + (1000 / Math.max(dt, 1)) * 0.1;

  resize();
  cam.update(dt / 1000, input.panAxis());

  acc += dt;
  let ticked = false;
  while (acc >= TICK_MS) {
    renderer.snapshotCarriers();
    step(world, input.drain());
    acc -= TICK_MS;
    ticked = true;
  }

  // Vom Holzfaeller abgeholzte Tiles aus dem Chunk-Cache werfen.
  if (world.dirty.size > 0) {
    for (const key of world.dirty) {
      const [x, y] = parseKey(key);
      renderer.invalidateTile(x, y);
    }
    world.dirty.clear();
  }

  renderer.draw(acc / TICK_MS, input.hoverTile());

  if (ticked && now - lastHashAt > 500) {
    hashCache = hashWorldHex(world);
    lastHashAt = now;
  }
  if (now - lastSaveAt > 10000) {
    lastSaveAt = now;
    void autosave();
  }

  updateHud();
  requestAnimationFrame(frame);
}

async function autosave(): Promise<void> {
  try {
    await saveSnapshot(serialize(world));
    saveState = 'automatisch gespeichert';
  } catch (err) {
    saveState = 'Speichern fehlgeschlagen';
    console.warn(err);
  }
}

function updateHud(): void {
  const h = input.hoverTile();
  hud.update({
    tick: world.state.tick,
    hash: hashCache || '...',
    fps,
    camX: cam.x,
    camY: cam.y,
    zoom: cam.zoom,
    hover: h ? { x: h.x, y: h.y, tile: TILE_NAMES[getTile(world, h.x, h.y)] } : null,
    chunksCached: renderer.cachedChunks,
    chunksGenerated: world.chunks.generatedCount,
    chunksPending: renderer.pendingChunks,
    buildings: world.state.buildings.size,
    carriers: world.state.carriers.size,
    stock: stockSummary(world),
    seed: world.state.seed,
    saved: saveState,
  });
}

window.addEventListener('beforeunload', () => {
  void saveSnapshot(serialize(world));
});

/**
 * Debug-Zugriff aus der Browserkonsole.
 *
 * Ab M5 der schnellste Weg, einen Desync einzukreisen: in beiden Clients
 * __settler.hash() aufrufen und die Ticks vergleichen, bei denen die Werte
 * zum ersten Mal auseinanderlaufen.
 */
(window as unknown as Record<string, unknown>).__settler = {
  get world() {
    return world;
  },
  get renderer() {
    return renderer;
  },
  cam,
  input,
  hash: () => hashWorldHex(world),
  /** Einen Frame von Hand ausloesen - nuetzlich, wenn rAF pausiert. */
  frame,
};

void boot();
