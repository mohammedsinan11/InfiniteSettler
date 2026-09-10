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
import { FP_ONE } from '../sim/fixed';
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
import { wandererAt, worldSiteAt } from '../sim/living-world';
import {
  beginExpedition,
  canBuildInRun,
  expeditionNearLand,
  isBuildingUnlocked,
  isExplored,
} from '../sim/run';
import {
  BUILDING_SPECS, BuildingType, GOOD_COUNT, GOOD_NAMES, RunPhase,
  WandererKind, WorldSiteKind, type Building, type Wanderer, type WorldSite,
} from '../sim/types';
import { TICK_MS, step } from '../sim/tick';
import { Camera } from './camera';
import { emptyGameAssets, loadGameAssets } from './assets';
import { Hud, type HudObjective, type HudSelection } from './hud';
import { BUILD_TYPE, Input, MODES, Mode } from './input';
import { ExpeditionMusic } from './music';
import { clearSnapshot, loadSnapshot, saveSnapshot } from './persist';
import { Renderer, type BuildPreview } from './renderer';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const cam = new Camera();

let world: World = createExpeditionWorld(seedFromUrl());
let gameAssets = emptyGameAssets();
let renderer = new Renderer(canvas, world, cam, gameAssets);
let selectedScout = false;
let selectedTile: { x: number; y: number } | null = null;
let expeditionFollow = true;
const music = new ExpeditionMusic();

const input = new Input(canvas, cam);
const hud = new Hud(
  (m) => input.setMode(m),
  () => void newWorld((Math.random() * 0x7fffffff) | 0),
  () => void resetSave(),
  () => recenterView(),
  (speed) => setSimulationSpeed(speed),
  () => upgradeSelection(),
  () => {
    const enabled = music.toggle();
    hud.toast(enabled ? 'Expeditionsmusik eingeschaltet.' : 'Musik ausgeschaltet.');
  },
);
input.canUseMode = (mode) => isModeAvailable(mode);
input.onModeDenied = () => hud.toast('Dieses Vorhaben wird erst im Verlauf der Expedition freigeschaltet.', 'warning');
input.onModeChange = (m) => {
  if (m !== Mode.Pan) selectedScout = false;
  hud.setMode(m);
};
input.onManualCamera = () => { expeditionFollow = false; };
input.isDraggableUnitAt = (x, y) => isScoutAt(x, y);
input.onUnitSelect = () => selectScout();
input.onUnitMove = (x, y) => moveSelectedScout(x, y);
input.onInspect = (x, y) => {
  selectedTile = { x, y };
  if (world.state.run.phase !== RunPhase.Voyage) {
    const scout = world.state.run.scout;
    const scoutX = scout ? Math.round(scout.x / FP_ONE) : 0;
    const scoutY = scout ? Math.round(scout.y / FP_ONE) : 0;
    if (scout && x === scoutX && y === scoutY) {
      selectScout();
      return;
    }
    if (selectedScout && buildingAtTile(world, x, y) === undefined) {
      moveSelectedScout(x, y);
      return;
    }
    selectedScout = false;
    return;
  }
  if (!isExplored(world, x, y)) {
    hud.toast('Dieser Teil der Karte ist noch unentdeckt. Fahre bis an den Nebelrand.', 'warning');
    return;
  }
  if (getTile(world, x, y) === Tile.Water) {
    input.enqueue({ t: 'sail', x, y });
    hud.toast('Kurs gesetzt. Die Expedition folgt dem Seeweg.', 'success');
    return;
  }
  if (canBuildInRun(world, BuildingType.Storehouse, x, y)) {
    input.setMode(Mode.Storehouse);
    hud.toast('Küste erreicht. Setze hier das erste Lager.', 'success');
  } else {
    hud.toast('Die Küste ist zu weit entfernt. Fahre näher heran.', 'warning');
  }
};
input.onAttempt = (mode, x, y) => explainAttempt(mode, x, y);
// Dieselbe Verlegung wie in der Vorschau - siehe buildPreview().
input.resolveBuild = (x, y) => {
  const type = BUILD_TYPE[input.mode];
  if (type === undefined) return { x, y };
  if (world.state.run.phase === RunPhase.Voyage) return { x, y };
  return snapPlacement(world, type, x, y) ?? { x, y };
};
input.setMode(Mode.Pan);

function isScoutAt(x: number, y: number): boolean {
  if (world.state.run.phase !== RunPhase.Settled || !world.state.run.scout) return false;
  return x === Math.round(world.state.run.scout.x / FP_ONE)
    && y === Math.round(world.state.run.scout.y / FP_ONE);
}

function selectScout(): void {
  if (!world.state.run.scout) return;
  selectedScout = true;
  selectedTile = null;
  hud.toast('Späher ausgewählt · ziehen oder ein Landziel anklicken.', 'success');
}

function moveSelectedScout(x: number, y: number): void {
  if (!selectedScout) return;
  if (getTile(world, x, y) === Tile.Water) {
    hud.toast('Der Späher braucht einen Landweg.', 'warning');
    return;
  }
  input.enqueue({ t: 'scout', x, y });
  selectedTile = null;
  hud.toast('Späher unterwegs.', 'success');
}

function isModeAvailable(mode: Mode): boolean {
  if (mode === Mode.Pan) return true;
  const type = BUILD_TYPE[mode];
  if (type !== undefined) return isBuildingUnlocked(world, type);
  return world.state.run.phase === RunPhase.Settled;
}

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

function createExpeditionWorld(seed: number): World {
  const next = createWorld(seed);
  beginExpedition(next);
  return next;
}

function centerOnExpedition(): boolean {
  const expedition = world.state.run.expedition;
  if (!expedition) return false;
  cam.jumpTo(expedition.x / FP_ONE, expedition.y / FP_ONE);
  if (world.state.run.phase === RunPhase.Voyage) {
    cam.setZoom(29);
    expeditionFollow = true;
  }
  return true;
}

function recenterView(): void {
  if (world.state.run.phase === RunPhase.Voyage && centerOnExpedition()) {
    hud.toast('Kompass auf das Expeditionsschiff ausgerichtet.', 'success');
    return;
  }
  if (centerOnSettlement()) {
    cam.setZoom(Math.max(cam.zoom, 22));
    hud.toast('Zur Siedlung zurückgekehrt.', 'success');
    return;
  }
  centerOnLand();
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
  attachWorld(createExpeditionWorld(seed));
  selectedTile = null;
  selectedScout = false;
  input.setMode(Mode.Pan);
  centerOnExpedition();
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
      if (!centerOnSettlement() && !centerOnExpedition()) centerOnLand();
    } else {
      centerOnExpedition();
    }
  } catch (err) {
    // Haeufigster Fall: Spielstand aus einer aelteren Terrainversion.
    console.warn('Spielstand verworfen:', err);
    await clearSnapshot().catch(() => undefined);
    saveState = 'alter Spielstand verworfen';
    centerOnExpedition();
  }
  gameAssets = await assetsPromise;
  renderer.setAssets(gameAssets);
  music.setPhase(world.state.run.phase === RunPhase.Voyage ? 'voyage' : 'settled');
  // Das HUD nimmt seine Icons aus denselben Sprites - der Bauknopf zeigt
  // damit genau das Gebaeude, das danach auf der Karte steht.
  hud.setAssets(gameAssets);
  hud.setMode(input.mode);
  hud.setWelcome(world.state.run.phase === RunPhase.Voyage);
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
    valid: canPlaceBuilding(world, type, at.x, at.y)
      && canBuildInRun(world, type, at.x, at.y),
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
  const panAxis = input.panAxis();
  if (panAxis.x !== 0 || panAxis.y !== 0) expeditionFollow = false;
  cam.update(dt / 1000, panAxis);

  acc += paused ? 0 : dt * simSpeed;
  let ticked = false;
  let landed = false;
  while (acc >= TICK_MS) {
    renderer.snapshotCarriers();
    const previousPhase = world.state.run.phase;
    step(world, input.drain());
    if (previousPhase === RunPhase.Voyage && world.state.run.phase === RunPhase.Settled) {
      landed = true;
    }
    acc -= TICK_MS;
    ticked = true;
  }
  if (landed) {
    expeditionFollow = false;
    music.setPhase('settled');
    selectedTile = null;
    selectedScout = world.state.run.scout !== null;
    input.setMode(Mode.Pan);
    hud.toast('Die Siedlung ist gegründet. Der Späher ist ausgewählt und bereit.', 'success');
  }

  if (expeditionFollow && world.state.run.phase === RunPhase.Voyage) {
    const expedition = world.state.run.expedition;
    if (expedition) cam.follow(expedition.x / FP_ONE, expedition.y / FP_ONE, dt / 1000);
  }

  // Vom Holzfaeller abgeholzte Tiles aus dem Chunk-Cache werfen.
  if (world.dirty.size > 0) {
    for (const key of world.dirty) {
      const [x, y] = parseKey(key);
      renderer.invalidateTile(x, y);
    }
    world.dirty.clear();
  }

  renderer.draw(acc / TICK_MS, buildPreview(), selectedScout);
  const hover = input.hoverTile();
  canvas.classList.toggle('can-select-unit', input.mode === Mode.Pan
    && hover !== null && isScoutAt(hover.x, hover.y));

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
    hover: h ? {
      x: h.x,
      y: h.y,
      tile: isExplored(world, h.x, h.y) ? TILE_NAMES[getTile(world, h.x, h.y)] : 'Unentdeckt',
    } : null,
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
    availableModes: Object.fromEntries(
      MODES.map((entry) => [entry.mode, isModeAvailable(entry.mode)]),
    ),
    availableGoods: availableBuildingGoods(),
    seed: world.state.seed,
    saved: saveState,
    home: findHome(),
    paused,
    speed: simSpeed,
    objective: currentObjective(),
    selection: currentSelection(),
    expedition: world.state.run.phase === RunPhase.Voyage
      ? { supplies: world.state.run.expedition?.supplies ?? 0 }
      : null,
    musicEnabled: music.enabled,
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
  if (world.state.run.phase === RunPhase.Voyage) {
    const supplies = world.state.run.expedition?.supplies ?? 0;
    if (expeditionNearLand(world)) return {
      eyebrow: `Expedition · ${supplies} Vorräte`,
      title: 'Eine Heimat an dieser Küste gründen',
      reason: 'Klicke auf das Land und setze das kostenlose Lager nahe am Schiff.',
      progress: .12,
      actionMode: Mode.Storehouse,
    };
    return {
      eyebrow: `Expedition · ${supplies} Vorräte`,
      title: 'Eine verheißungsvolle Küste finden',
      reason: 'Klicke auf entdecktes Wasser, um einen Kurs zu setzen.',
      progress: .04,
      actionMode: Mode.Pan,
    };
  }
  const worldNotice = currentWorldNotice();
  if (worldNotice) return worldNotice;
  if (world.state.run.fogEnabled && (world.state.run.scout?.exploredSteps ?? 0) < 4) {
    return {
      eyebrow: 'Erkundung · Das unbekannte Land',
      title: 'Den Späher aussenden',
      reason: 'Greife den grün markierten Späher und ziehe ihn zu einem Landstück am Nebelrand.',
      progress: .16,
      actionMode: Mode.Pan,
    };
  }
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

const SITE_META: Record<WorldSite['kind'], {
  name: string;
  faction: string;
  emblem: string;
  discovery: string;
}> = {
  [WorldSiteKind.Ruin]: {
    name: 'Vergessene Ruine', faction: 'Unbekannte Herkunft', emblem: '⌂',
    discovery: 'Zwischen zerbrochenen Mauern glimmt ein altes Siegel. Dieser Ort birgt eine Geschichte – und vermutlich Beute.',
  },
  [WorldSiteKind.Tidewatch]: {
    name: 'Wacht der Gezeiten', faction: 'Küstenbund', emblem: '⚓',
    discovery: 'Goldene Banner stehen über einem fremden Küstenlager. Der Küstenbund beobachtet diese Gewässer.',
  },
  [WorldSiteKind.GroveCircle]: {
    name: 'Kreis der Mooshüter', faction: 'Mooshüter', emblem: '✦',
    discovery: 'Steine und grünes Licht markieren einen bewohnten Hain. Die Mooshüter dulden Besucher, aber keine Holzfäller.',
  },
};

function currentWorldNotice(): HudObjective | null {
  let site: WorldSite | null = null;
  let eventTick = -1;
  let visited = false;
  for (const candidate of world.state.run.sites) {
    const candidateTick = Math.max(candidate.discoveredTick, candidate.visitedTick);
    if (candidateTick <= eventTick || candidateTick < 0) continue;
    site = candidate;
    eventTick = candidateTick;
    visited = candidate.visitedTick >= candidate.discoveredTick && candidate.visitedTick >= 0;
  }
  // Auch bei 4x Tempo lange genug lesbar, ohne das normale Siedlungsziel
  // dauerhaft zu verdraengen.
  if (!site || world.state.tick - eventTick > 1200) return null;
  const meta = SITE_META[site.kind];
  return visited ? {
    eyebrow: `Weltnachricht · ${meta.faction}`,
    title: `${meta.name} erreicht`,
    reason: 'Der Späher hat einen sicheren Zugang gefunden. Fremde Zeichen deuten auf mehrere Wege und unterschiedliche Beute hin.',
    progress: 1,
  } : {
    eyebrow: `Weltnachricht · ${meta.faction}`,
    title: meta.name,
    reason: meta.discovery,
    progress: 1,
  };
}

function currentSelection(): HudSelection | null {
  if (selectedScout && world.state.run.scout) {
    const scout = world.state.run.scout;
    return {
      kind: 'unit', title: 'Späher', subtitle: 'Erkundungstrupp · direkt über die Karte ziehen',
      lines: [
        { label: 'Standort', value: `${Math.round(scout.x / FP_ONE)}, ${Math.round(scout.y / FP_ONE)}` },
        { label: 'Aufgabe', value: scout.path.length > 0 ? 'Unterwegs' : 'Bereit' },
      ],
    };
  }
  if (!selectedTile) return null;
  if (!isExplored(world, selectedTile.x, selectedTile.y)) return {
    kind: 'tile', title: 'Unentdeckt', subtitle: 'Jenseits des Kartenrandes',
    lines: [{ label: 'Hinweis', value: 'Erkunde die Gegend mit deiner Expedition.' }],
  };
  const site = worldSiteAt(world, selectedTile.x, selectedTile.y);
  if (site) return siteSelection(site);
  const building = buildingAtTile(world, selectedTile.x, selectedTile.y);
  if (building) return buildingSelection(building);
  const wanderer = wandererAt(world, selectedTile.x, selectedTile.y);
  if (wanderer) return wandererSelection(wanderer);
  return {
    kind: 'tile', title: TILE_NAMES[getTile(world, selectedTile.x, selectedTile.y)],
    subtitle: `Kachel ${selectedTile.x}, ${selectedTile.y}`,
    lines: [
      { label: 'Bebaubar', value: isBuildable(getTile(world, selectedTile.x, selectedTile.y)) ? 'Ja' : 'Nein' },
      { label: 'Straße', value: hasRoad(world, selectedTile.x, selectedTile.y) ? 'Vorhanden' : 'Keine' },
    ],
  };
}

function siteSelection(site: WorldSite): HudSelection {
  const meta = SITE_META[site.kind];
  return {
    kind: 'tile', emblem: meta.emblem, title: meta.name, subtitle: `${meta.faction} · Weltort`,
    lines: [
      { label: 'Standort', value: `${site.x}, ${site.y}` },
      { label: 'Beziehung', value: site.kind === WorldSiteKind.Ruin ? 'Ungeklärt' : 'Neutral' },
      { label: 'Zustand', value: site.visitedTick >= 0 ? 'Vom Späher erreicht' : 'Noch nicht untersucht' },
    ],
  };
}

function wandererSelection(wanderer: Wanderer): HudSelection {
  const meta = {
    [WandererKind.Deer]: { name: 'Waldhirsch', role: 'Wildtier', emblem: '♞' },
    [WandererKind.Boar]: { name: 'Wildschwein', role: 'Wildtier', emblem: '◆' },
    [WandererKind.Wayfarer]: { name: 'Fremder Wanderer', role: 'Neutraler Reisender', emblem: '♟' },
  }[wanderer.kind];
  return {
    kind: 'unit', emblem: meta.emblem, title: meta.name, subtitle: `${meta.role} · zieht frei umher`,
    lines: [
      { label: 'Standort', value: `${Math.round(wanderer.x / FP_ONE)}, ${Math.round(wanderer.y / FP_ONE)}` },
      { label: 'Verhalten', value: wanderer.path.length > 0 ? 'Auf Wanderschaft' : 'Rastet' },
      { label: 'Haltung', value: 'Neutral' },
    ],
  };
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
  return {
    kind: 'building',
    title: displayBuildingName(building.type),
    subtitle: `Gebäude #${building.id}`,
    lines,
    action: spec.upgradesTo === -1 ? undefined : {
      label: canUpgrade(world, building.x, building.y)
        ? `Zu ${BUILDING_SPECS[spec.upgradesTo].name} ausbauen`
        : 'Ausbau noch nicht bezahlbar',
      enabled: canUpgrade(world, building.x, building.y),
    },
  };
}

function upgradeSelection(): void {
  if (!selectedTile) return;
  if (!canUpgrade(world, selectedTile.x, selectedTile.y)) {
    hud.toast('Für diesen Ausbau fehlen noch Waren.', 'warning');
    return;
  }
  input.enqueue({ t: 'upgrade', x: selectedTile.x, y: selectedTile.y });
  hud.toast('Ausbau beauftragt.', 'success');
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
    if (!isBuildingUnlocked(world, type)) {
      hud.toast('Dieses Gebäude wird durch die nächsten Siedlungsziele freigeschaltet.', 'warning');
    } else if (!canBuildInRun(world, type, x, y)) {
      hud.toast(world.state.run.phase === RunPhase.Voyage
        ? (type === BuildingType.Storehouse
          ? 'Das Lager muss nahe am Expeditionsschiff stehen.'
          : 'Zuerst muss die Expedition mit einem Lager anlanden.')
        : 'Erkunde diesen Bauplatz zuerst mit dem Späher.', 'warning');
    } else if (!canAfford(world, type)) hud.toast('Nicht genügend Waren im Lager.', 'warning');
    else if (!canPlaceBuilding(world, type, x, y)) hud.toast('Dieser Standort ist für das Gebäude ungeeignet oder belegt.', 'warning');
    return;
  }
  if (world.state.run.phase === RunPhase.Voyage && mode !== Mode.Pan) {
    hud.toast('Zuerst muss die Expedition mit einem Lager anlanden.', 'warning');
    return;
  }
  if (mode === Mode.Road && !isExplored(world, x, y)) {
    hud.toast('Erkunde dieses Gebiet zuerst mit dem Späher.', 'warning');
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
