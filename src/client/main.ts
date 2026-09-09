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

import { canAfford, canUpgrade } from '../sim/commands';
import { population, workersNeeded } from '../sim/economy';
import { parseKey } from '../sim/coords';
import { hashWorldHex, serialize, deserialize } from '../sim/serialize';
import {
  buildingAtTile,
  buildingIdAt,
  canPlaceBuilding,
  createWorld,
  getTile,
  hasRoad,
  snapPlacement,
  stockSummary,
  type World,
} from '../sim/state';
import { isBuildable, TILE_NAMES, Tile } from '../sim/terrain';
import { BUILDING_SPECS, BuildingType, GOOD_COUNT, GOOD_NAMES, type Building } from '../sim/types';
import { TICK_MS, step } from '../sim/tick';
import { Camera } from './camera';
import { emptyGameAssets, loadGameAssets } from './assets';
import { Hud, type HudObjective, type HudSelection } from './hud';
import { BUILD_TYPE, Input, Mode } from './input';
import { clearSnapshot, loadSnapshot, saveSnapshot } from './persist';
import { Renderer, type BuildPreview } from './renderer';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const cam = new Camera();

let world: World = createWorld(seedFromUrl());
let gameAssets = emptyGameAssets();
let renderer = new Renderer(canvas, world, cam, gameAssets);

const input = new Input(canvas, cam);
const hud = new Hud(
  (m) => input.setMode(m),
  () => void newWorld((Math.random() * 0x7fffffff) | 0),
  () => void resetSave(),
  () => {
    if (!centerOnSettlement()) centerOnLand();
  },
  (speed) => setSimulationSpeed(speed),
);
input.onModeChange = (m) => hud.setMode(m);
input.onInspect = (x, y) => {
  selectedTile = { x, y };
};
input.onAttempt = (mode, x, y) => explainAttempt(mode, x, y);
// Dieselbe Verlegung wie in der Vorschau - siehe buildPreview().
input.resolveBuild = (x, y) => {
  const type = BUILD_TYPE[input.mode];
  if (type === undefined) return { x, y };
  return snapPlacement(world, type, x, y) ?? { x, y };
};
input.setMode(Mode.Pan);

/** Wasserfreie Vorschau fuer den grossen Hafen waehrend des Asset-Umbaus. */
const buildingSprite = (type: BuildingType): HTMLImageElement | null =>
  gameAssets.buildings[type]?.[0]
  ?? (type === BuildingType.Harbor ? gameAssets.smallHarbor.down : null);

// --- Aufsetzen ---------------------------------------------------------

function seedFromUrl(): number {
  const m = /seed=(-?\d+)/.exec(location.hash);
  // Math.random ist hier unbedenklich: der Seed wird EINMAL gezogen und
  // danach Teil des Weltzustands. In src/sim waere er verboten.
  return m ? Number(m[1]) | 0 : (Math.random() * 0x7fffffff) | 0;
}

function attachWorld(next: World): void {
  world = next;
  renderer = new Renderer(canvas, world, cam, gameAssets);
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
  selectedTile = null;
  centerOnLand();
  await clearSnapshot();
  saveState = 'neue Welt';
  hud.setWelcome(true);
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
/** Ankerkachel der eigenen Siedlung: erstes Lager, sonst erstes Gebaeude. */
function findHome(): { x: number; y: number } | null {
  let home: { x: number; y: number } | null = null;
  let homeId = Infinity;
  for (const b of world.state.buildings.values()) {
    const preferred = b.type === BuildingType.Storehouse;
    if (home !== null && !preferred) continue;
    if (preferred && b.id > homeId) continue;
    home = { x: b.x, y: b.y };
    if (preferred) homeId = b.id;
  }
  return home;
}

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
  const assetsPromise = loadGameAssets().catch((err) => {
    // Die Simulation und die farbigen Fallbacks bleiben auch bei einem
    // defekten oder unvollstaendigen Asset-Build spielbar.
    console.warn('Grafikpaket konnte nicht geladen werden:', err);
    return emptyGameAssets();
  });
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
    // Haeufigster Fall: Spielstand aus einer aelteren Terrainversion.
    console.warn('Spielstand verworfen:', err);
    await clearSnapshot().catch(() => undefined);
    saveState = 'alter Spielstand verworfen';
    centerOnLand();
  }
  gameAssets = await assetsPromise;
  renderer.setAssets(gameAssets);
  // Das HUD nimmt seine Icons aus denselben Sprites - der Bauknopf zeigt
  // damit genau das Gebaeude, das danach auf der Karte steht.
  hud.setAssets(gameAssets);
  hud.setMode(input.mode);
  hud.setWelcome(world.state.buildings.size === 0);
  requestAnimationFrame(frame);
}

/**
 * Baut die Vorschau fuer die aktuelle Zeigerposition.
 *
 * Die Gueltigkeit kommt aus canPlaceBuilding, also aus derselben Funktion,
 * die auch der Command benutzt - eine zweite Regel im Client koennte
 * abweichen und unter Lockstep einen Desync erzeugen.
 */
function buildPreview(): BuildPreview | null {
  const hover = input.hoverTile();
  if (!hover) return null;

  // Im Ausbaumodus zeigt die Vorschau das getroffene Gebaeude, nicht die
  // Kachel unter dem Zeiger: sonst sieht man nicht, ob man das Haus ueber-
  // haupt erwischt und ob der Ausbau bezahlbar ist.
  if (input.mode === Mode.Upgrade) {
    const id = buildingIdAt(world, hover.x, hover.y);
    const b = id === undefined ? undefined : world.state.buildings.get(id);
    if (!b) {
      return { x: hover.x, y: hover.y, footprint: 1, valid: false, snapped: false, image: null };
    }
    const next = BUILDING_SPECS[b.type].upgradesTo;
    return {
      x: b.x,
      y: b.y,
      footprint: BUILDING_SPECS[b.type].footprint,
      valid: canUpgrade(world, hover.x, hover.y),
      snapped: false,
      image: next === -1 ? null : buildingSprite(next),
    };
  }

  const type = BUILD_TYPE[input.mode];
  if (type === undefined) {
    return { x: hover.x, y: hover.y, footprint: 1, valid: true, snapped: false, image: null };
  }

  const snap = snapPlacement(world, type, hover.x, hover.y);
  const at = snap ?? hover;
  return {
    x: at.x,
    y: at.y,
    footprint: BUILDING_SPECS[type].footprint,
    valid: canPlaceBuilding(world, type, at.x, at.y),
    snapped: snap !== null && (snap.x !== hover.x || snap.y !== hover.y),
    image: buildingSprite(type),
  };
}

// --- Schleife ----------------------------------------------------------

let acc = 0;
let last = performance.now();
let fps = 0;
let hashCache = '';
let lastHashAt = 0;
let lastSaveAt = 0;
let saveState = 'noch nicht gespeichert';
let paused = false;
let simSpeed: 1 | 2 | 4 = 1;
let selectedTile: { x: number; y: number } | null = null;

function setSimulationSpeed(value: 0 | 1 | 2 | 4): void {
  if (value === 0) {
    paused = !paused;
    hud.toast(paused ? 'Simulation pausiert' : `Simulation läuft mit ${simSpeed}×`);
    return;
  }
  simSpeed = value;
  paused = false;
  hud.toast(`Simulationsgeschwindigkeit: ${value}×`);
}

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

  acc += paused ? 0 : dt * simSpeed;
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

  renderer.draw(acc / TICK_MS, buildPreview());

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
  const stock = stockSummary(world);
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
    stock,
    population: population(world),
    workersNeeded: workersNeeded(world),
    affordable: Object.fromEntries(
      Object.values(BuildingType).map((t) => [t, canAfford(world, t)]),
    ),
    availableGoods: availableBuildingGoods(),
    seed: world.state.seed,
    saved: saveState,
    home: findHome(),
    paused,
    speed: simSpeed,
    objective: currentObjective(),
    selection: currentSelection(),
  });
}

/** Lagerbestand abzüglich bereits zugesagter Abholungen, wie bei canAfford. */
function availableBuildingGoods(): number[] {
  const available = new Array<number>(GOOD_COUNT).fill(0);
  for (const building of world.state.buildings.values()) {
    if (!BUILDING_SPECS[building.type].isSink) continue;
    for (let good = 0; good < GOOD_COUNT; good++) {
      available[good] += Math.max(0, building.input[good] - building.reserved[good]);
    }
  }
  return available;
}

function hasBuilding(type: BuildingType): boolean {
  for (const building of world.state.buildings.values()) if (building.type === type) return true;
  return false;
}

function currentObjective(): HudObjective {
  const buildings = world.state.buildings.size;
  if (buildings === 0) return {
    eyebrow: 'Erster Eintrag · 0 von 7', title: 'Ein Lager als Ausgangspunkt',
    reason: 'Der erste Bau ist kostenlos und bringt Startvorräte sowie Träger.', progress: 0,
    actionMode: Mode.Storehouse,
  };
  if (!hasBuilding(BuildingType.Storehouse) && !hasBuilding(BuildingType.Depot)) return {
    eyebrow: 'Versorgung · 1 von 7', title: 'Warenfluss sichern',
    reason: 'Ein Umschlagplatz sammelt Waren und entsendet Träger.', progress: 1 / 7,
    actionMode: Mode.Depot,
  };
  if (!hasBuilding(BuildingType.Woodcutter)) return {
    eyebrow: 'Rohstoffe · 2 von 7', title: 'Holzgewinnung beginnen',
    reason: 'Setze den Holzfäller nah an Wald und verbinde ihn anschließend.', progress: 2 / 7,
    actionMode: Mode.Woodcutter,
  };
  if (world.state.roads.size < 3) return {
    eyebrow: 'Wege · 3 von 7', title: 'Den ersten Weg anlegen',
    reason: 'Träger bewegen Waren nur über verbundene Straßen und Gebäude.', progress: 3 / 7,
    actionMode: Mode.Road,
  };
  if (!hasBuilding(BuildingType.Sawmill)) return {
    eyebrow: 'Verarbeitung · 4 von 7', title: 'Bretter herstellen',
    reason: 'Das Sägewerk verwandelt Holz in den wichtigsten Baustoff.', progress: 4 / 7,
    actionMode: Mode.Sawmill,
  };
  if (!hasBuilding(BuildingType.FisherHut) && !hasBuilding(BuildingType.Farm)) return {
    eyebrow: 'Nahrung · 5 von 7', title: 'Eine Nahrungsquelle erschließen',
    reason: 'Fisch ist der schnelle Einstieg; Brot trägt später eine größere Siedlung.', progress: 5 / 7,
    actionMode: Mode.FisherHut,
  };
  if (!hasBuilding(BuildingType.House)) return {
    eyebrow: 'Bevölkerung · 6 von 7', title: 'Ein Wohnhaus errichten',
    reason: 'Ein versorgtes Haus bringt vier zusätzliche Arbeitskräfte.', progress: 6 / 7,
    actionMode: Mode.House,
  };
  const pop = population(world);
  const needed = workersNeeded(world);
  if (needed > pop) return {
    eyebrow: 'Arbeitskräfte · Engpass', title: 'Bevölkerung stabilisieren',
    reason: `${needed - pop} Arbeitsplätze sind unbesetzt. Liefere Nahrung oder baue ein weiteres Haus.`, progress: .9,
    actionMode: Mode.House,
  };
  return {
    eyebrow: 'Freies Spiel · Versorgung stabil', title: 'Die Siedlung weiterentwickeln',
    reason: 'Erschließe Stein, die Brotkette oder einen zweiten Hafenstandort.', progress: 1,
  };
}

function currentSelection(): HudSelection | null {
  if (!selectedTile) return null;
  const building = buildingAtTile(world, selectedTile.x, selectedTile.y);
  if (!building) {
    return {
      kind: 'tile', title: TILE_NAMES[getTile(world, selectedTile.x, selectedTile.y)],
      subtitle: `Kachel ${selectedTile.x}, ${selectedTile.y}`,
      lines: [
        { label: 'Bebaubar', value: isBuildable(getTile(world, selectedTile.x, selectedTile.y)) ? 'Ja' : 'Nein' },
        { label: 'Straße', value: hasRoad(world, selectedTile.x, selectedTile.y) ? 'Vorhanden' : 'Keine' },
      ],
    };
  }
  return buildingSelection(building);
}

function buildingSelection(building: Building): HudSelection {
  const spec = BUILDING_SPECS[building.type];
  const workerIds = [...world.state.buildings.values()]
    .filter((item) => BUILDING_SPECS[item.type].needsWorker)
    .map((item) => item.id).sort((a, b) => a - b);
  const staffed = !spec.needsWorker || workerIds.indexOf(building.id) < population(world);
  const stored = building.input.reduce((sum, value) => sum + value, 0)
    + building.output.reduce((sum, value) => sum + value, 0);
  const flow = spec.produces >= 0
    ? `${spec.consumes >= 0 ? GOOD_NAMES[spec.consumes as keyof typeof GOOD_NAMES] + ' → ' : ''}${GOOD_NAMES[spec.produces as keyof typeof GOOD_NAMES]}`
    : (spec.isSink ? 'Lagert und verteilt Waren' : 'Kein Warenfluss');
  const lines: { label: string; value: string }[] = [
    { label: 'Standort', value: `${building.x}, ${building.y}` },
    { label: 'Besetzung', value: staffed ? 'Arbeitsbereit' : 'Nicht besetzt' },
    { label: 'Aufgabe', value: flow },
    { label: 'Puffer', value: `${stored} Waren` },
  ];
  if (spec.upgradesTo !== -1) {
    const cost: string[] = [];
    for (let good = 0; good < GOOD_COUNT; good++) if (spec.upgradeCost[good] > 0) cost.push(`${spec.upgradeCost[good]} ${GOOD_NAMES[good as keyof typeof GOOD_NAMES]}`);
    lines.push({ label: 'Ausbau', value: `${BUILDING_SPECS[spec.upgradesTo].name} · ${cost.join(', ')}` });
  }
  return { kind: 'building', title: displayBuildingName(building.type), subtitle: `Gebäude #${building.id}`, lines };
}

function displayBuildingName(type: BuildingType): string {
  return ({
    [BuildingType.Woodcutter]: 'Holzfäller', [BuildingType.Sawmill]: 'Sägewerk',
    [BuildingType.FisherHut]: 'Fischerhütte', [BuildingType.Mill]: 'Mühle',
    [BuildingType.Bakery]: 'Bäckerei',
  } as Partial<Record<BuildingType, string>>)[type] ?? BUILDING_SPECS[type].name;
}

function explainAttempt(mode: Mode, x: number, y: number): void {
  const type = BUILD_TYPE[mode];
  if (type !== undefined) {
    if (!canAfford(world, type)) hud.toast('Nicht genügend Waren im Lager.', 'warning');
    else if (!canPlaceBuilding(world, type, x, y)) hud.toast('Dieser Standort ist für das Gebäude ungeeignet oder belegt.', 'warning');
    return;
  }
  if (mode === Mode.Road && (hasRoad(world, x, y) || buildingIdAt(world, x, y) !== undefined || !isBuildable(getTile(world, x, y)))) {
    hud.toast('Hier kann keine Straße verlaufen.', 'warning');
  } else if (mode === Mode.Upgrade && !canUpgrade(world, x, y)) {
    hud.toast('Kein bezahlbarer Ausbau an dieser Stelle.', 'warning');
  } else if (mode === Mode.Demolish && !hasRoad(world, x, y) && buildingIdAt(world, x, y) === undefined) {
    hud.toast('Hier gibt es nichts abzureißen.', 'warning');
  }
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
