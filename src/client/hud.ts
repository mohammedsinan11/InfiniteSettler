import type { StockSummary } from '../sim/state';
import {
  BUILDING_SPECS, GOOD_COUNT, GOOD_NAMES, Good, BuildingType,
  type BuildingType as BuildingKind,
} from '../sim/types';
import type { GameAssets, GoodSprite } from './assets';
import { emptyGameAssets } from './assets';
import { GOOD_COLOR } from './colors';
import { BUILD_TYPE, ModeGroup, MODES, Mode } from './input';
import './hud.css';

export interface HudSelection {
  kind: 'tile' | 'building';
  title: string;
  subtitle: string;
  lines: readonly { label: string; value: string }[];
}

export interface HudObjective {
  eyebrow: string;
  title: string;
  reason: string;
  progress: number;
  actionMode?: Mode;
}

export interface HudData {
  tick: number;
  hash: string;
  fps: number;
  camX: number;
  camY: number;
  zoom: number;
  hover: { x: number; y: number; tile: string } | null;
  chunksCached: number;
  chunksGenerated: number;
  chunksPending: number;
  buildings: number;
  carriers: number;
  stock: StockSummary;
  population: number;
  workersNeeded: number;
  affordable: Record<number, boolean>;
  /** Frei verfügbare Lagerware, also ohne bereits für Träger reservierte Mengen. */
  availableGoods: readonly number[];
  seed: number;
  saved: string;
  home: { x: number; y: number } | null;
  paused: boolean;
  speed: 1 | 2 | 4;
  objective: HudObjective;
  selection: HudSelection | null;
}

const GOOD_ICON: Partial<Record<Good, GoodSprite>> = {
  [Good.Wood]: 'wood', [Good.Plank]: 'plank', [Good.Stone]: 'stone',
  [Good.Fish]: 'fish', [Good.Grain]: 'grain', [Good.Flour]: 'flour', [Good.Bread]: 'bread',
};
const CORE_GOODS: readonly Good[] = [Good.Wood, Good.Plank, Good.Stone, Good.Fish];

const BUILD_META: Record<BuildingKind, { description: string; chapter: string }> = {
  [BuildingType.Woodcutter]: { description: 'Fällt nahe Bäume und liefert Holz.', chapter: 'Grundversorgung' },
  [BuildingType.Sawmill]: { description: 'Verarbeitet Holz zu Brettern.', chapter: 'Grundversorgung' },
  [BuildingType.Quarry]: { description: 'Gewinnt Stein aus nahen Felsfeldern.', chapter: 'Grundversorgung' },
  [BuildingType.House]: { description: 'Nahrung schafft hier neue Arbeitskräfte.', chapter: 'Grundversorgung' },
  [BuildingType.FisherHut]: { description: 'Fängt erneuerbaren Fisch an der Küste.', chapter: 'Nahrung' },
  [BuildingType.Farm]: { description: 'Erzeugt Getreide für die Brotkette.', chapter: 'Nahrung' },
  [BuildingType.Mill]: { description: 'Mahlt Getreide zu Mehl.', chapter: 'Nahrung' },
  [BuildingType.Bakery]: { description: 'Backt sättigendes Brot aus Mehl.', chapter: 'Nahrung' },
  [BuildingType.Depot]: { description: 'Einfacher Umschlagplatz mit zwei Trägern.', chapter: 'Logistik' },
  [BuildingType.Storehouse]: { description: 'Lagert Waren und entsendet vier Träger.', chapter: 'Grundversorgung' },
  [BuildingType.SmallHarbor]: { description: 'Kleiner Anleger für ein Handelsschiff.', chapter: 'Logistik' },
  [BuildingType.Harbor]: { description: 'Großer Umschlagplatz mit zwei Schiffen.', chapter: 'Logistik' },
};
const CHAPTERS = ['Grundversorgung', 'Nahrung', 'Logistik'] as const;
const TOOL_MARK: Partial<Record<Mode, string>> = {
  [Mode.Road]: '╱', [Mode.Upgrade]: '↑', [Mode.Demolish]: '×',
};

export class Hud {
  private assets: GameAssets = emptyGameAssets();
  private resources: HTMLElement;
  private catalog: HTMLElement;
  private catalogScroll: HTMLElement;
  private system: HTMLElement;
  private diagnostics: HTMLElement;
  private objective: HTMLElement;
  private inspector: HTMLElement;
  private welcome: HTMLElement;
  private welcomeBackdrop: HTMLElement;
  private toastEl: HTMLElement;
  private titleState: HTMLElement;
  private readonly buildBtn: HTMLButtonElement;
  private readonly mapBtn: HTMLButtonElement;
  private readonly systemBtn: HTMLButtonElement;
  private readonly diagnosticBtn: HTMLButtonElement;
  private modalPeers: HTMLElement[] = [];
  private modeButtons = new Map<Mode, HTMLButtonElement>();
  private speedButtons = new Map<number, HTMLButtonElement>();
  private buildTiles = new Map<Mode, HTMLButtonElement>();
  private lastResourceKey = '';
  private lastAffordKey = '';
  private lastObjectiveKey = '';
  private lastSelectionKey = '';
  private toastTimer = 0;

  constructor(
    private onMode: (m: Mode) => void,
    onNewWorld: () => void,
    onReset: () => void,
    onRecenter: () => void,
    onSpeed: (speed: 0 | 1 | 2 | 4) => void,
  ) {
    const header = el('header', 'is-header');
    const left = el('div', 'is-header-left');
    this.systemBtn = button('', () => {
      this.dismissWelcome();
      this.togglePanel(this.system);
    }, 'is-menu');
    this.systemBtn.innerHTML = '<span aria-hidden="true">☰</span><span class="is-sr-only">Menü</span>';
    const identity = el('div', 'is-identity');
    identity.innerHTML = '<span class="is-seal" aria-hidden="true">IS</span><div><h1>Infinite Settler</h1><p>Siedlung im Aufbau</p></div>';
    this.titleState = identity.querySelector('p') as HTMLElement;
    this.mapBtn = button('Karte', () => { this.onMode(Mode.Pan); this.closePanels(); }, 'is-map-mode');
    this.mapBtn.title = 'Karte ansehen und Gebäude auswählen (1)';
    left.append(this.systemBtn, identity, this.mapBtn);
    this.resources = el('div', 'is-resources');
    header.append(left, this.resources);

    this.objective = el('aside', 'is-objective');
    this.inspector = el('aside', 'is-inspector');
    this.inspector.hidden = true;

    this.catalog = el('section', 'is-catalog');
    this.catalog.setAttribute('aria-label', 'Siedlungsbuch');
    this.catalog.innerHTML = '<header class="is-panel-head"><div><span class="is-kicker">Siedlungsbuch</span><h2>Bauvorhaben</h2></div><button type="button" class="is-close" aria-label="Schließen">×</button></header>';
    this.catalog.querySelector('button')?.addEventListener('click', () => this.closePanels());
    this.catalogScroll = el('div', 'is-catalog-scroll');
    this.catalog.append(this.catalogScroll);

    this.system = el('section', 'is-system');
    this.system.setAttribute('aria-label', 'Systemsteuerung');
    this.system.innerHTML = '<header class="is-panel-head"><div><span class="is-kicker">Kartentisch</span><h2>Steuerung</h2></div><button type="button" class="is-close" aria-label="Schließen">×</button></header>';
    this.system.querySelector('button')?.addEventListener('click', () => this.closePanels());
    const speedRow = el('div', 'is-speed');
    speedRow.append(label('Zeitraffer'));
    for (const value of [0, 1, 2, 4] as const) {
      const speedButton = button(value === 0 ? 'Pause' : `${value}×`, () => onSpeed(value), 'is-speed-btn');
      this.speedButtons.set(value, speedButton);
      speedRow.append(speedButton);
    }
    const actions = el('div', 'is-system-actions');
    actions.append(
      button('Zur Siedlung', onRecenter, 'is-action'),
      button('Neue Welt', onNewWorld, 'is-action'),
      button('Spielstand zurücksetzen', () => {
        if (window.confirm('Den aktuellen Spielstand unwiderruflich zurücksetzen?')) onReset();
      }, 'is-action is-danger'),
    );
    this.diagnosticBtn = button('Diagnostik anzeigen', () => this.toggleDiagnostics(), 'is-action');
    actions.append(this.diagnosticBtn);
    this.system.append(speedRow, actions);

    this.diagnostics = el('aside', 'is-diagnostics');
    this.diagnostics.hidden = true;

    const dock = el('nav', 'is-dock');
    dock.setAttribute('aria-label', 'Bauwerkzeuge');
    dock.append(this.makeTool(Mode.Road));
    this.buildBtn = button('', () => {
      this.dismissWelcome();
      this.togglePanel(this.catalog);
    }, 'is-tool is-build');
    this.buildBtn.innerHTML = '<span class="is-tool-mark" aria-hidden="true">＋</span><span>Bauen</span><kbd>C</kbd>';
    dock.append(this.buildBtn, this.makeTool(Mode.Upgrade), this.makeTool(Mode.Demolish));

    this.welcome = el('section', 'is-welcome');
    this.welcome.id = 'settler-welcome';
    this.welcome.setAttribute('role', 'dialog');
    this.welcome.setAttribute('aria-modal', 'true');
    this.welcome.setAttribute('aria-labelledby', 'settler-welcome-title');
    this.welcome.innerHTML = `
      <span class="is-kicker">Willkommen am Kartentisch</span>
      <h2 id="settler-welcome-title">Aus einer Karte wird eine Heimat.</h2>
      <p>Errichte frei eine lebendige Siedlung und bringe Waren über Straßen und Wasser in Bewegung.</p>
      <ol><li><kbd>Ziehen</kbd> Karte bewegen</li><li><kbd>2</kbd> Straße malen</li><li><kbd>C</kbd> Gebäude wählen</li></ol>
      <button type="button" class="is-welcome-start">Planung beginnen <span aria-hidden="true">→</span></button>`;
    this.welcome.querySelector('button')?.addEventListener('click', () => {
      this.dismissWelcome();
      this.onMode(Mode.Storehouse);
      this.openCatalogAtStart();
    });
    this.welcomeBackdrop = el('div', 'is-welcome-backdrop');

    this.toastEl = el('div', 'is-toast');
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    document.body.append(header, this.objective, this.inspector, this.catalog, this.system, this.diagnostics, this.welcomeBackdrop, this.welcome, this.toastEl, dock);
    this.modalPeers = [header, this.objective, this.inspector, this.catalog, this.system, this.diagnostics, this.toastEl, dock];

    document.addEventListener('pointerdown', (event) => {
      const target = event.target as Node;
      if (!this.catalog.contains(target) && !this.buildBtn.contains(target)) this.catalog.classList.remove('is-open');
      if (!this.system.contains(target) && !this.systemBtn.contains(target)) this.system.classList.remove('is-open');
    });
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'c') {
        this.dismissWelcome();
        this.togglePanel(this.catalog);
      }
      if (event.key.toLowerCase() === 'i') this.toggleDiagnostics();
      if (event.key === 'Escape') { this.onMode(Mode.Pan); this.closePanels(); }
      if (event.key === ' ') { event.preventDefault(); onSpeed(0); }
    });
    this.refreshCatalog();
  }

  private makeTool(mode: Mode): HTMLButtonElement {
    const entry = MODES.find((item) => item.mode === mode);
    const node = button('', () => { this.onMode(mode); this.closePanels(); }, 'is-tool is-secondary-tool');
    node.innerHTML = `<span class="is-tool-mark" aria-hidden="true">${TOOL_MARK[mode] ?? '·'}</span><span>${entry?.label ?? mode}</span><kbd>${entry?.key ?? ''}</kbd>`;
    node.title = `${entry?.label ?? mode} – Taste ${entry?.key ?? ''}`;
    this.modeButtons.set(mode, node);
    return node;
  }

  private togglePanel(panel: HTMLElement, force?: boolean): void {
    const open = force ?? !panel.classList.contains('is-open');
    this.closePanels();
    panel.classList.toggle('is-open', open);
  }

  private openCatalogAtStart(): void {
    this.catalogScroll.scrollTop = 0;
    this.togglePanel(this.catalog, true);
    // Der Fokus kennzeichnet den empfohlenen Einstieg, ohne das Buch wie
    // scrollIntoView mitten auf einer bereits angeschnittenen Seite zu öffnen.
    requestAnimationFrame(() => {
      this.catalogScroll.scrollTop = 0;
      this.catalog.querySelector<HTMLButtonElement>('.is-recommended')?.focus({ preventScroll: true });
    });
  }

  private closePanels(): void {
    this.catalog.classList.remove('is-open');
    this.system.classList.remove('is-open');
  }

  private toggleDiagnostics(): void {
    this.diagnostics.hidden = !this.diagnostics.hidden;
    this.diagnosticBtn.textContent = this.diagnostics.hidden ? 'Diagnostik anzeigen' : 'Diagnostik schließen';
  }

  setAssets(assets: GameAssets): void {
    this.assets = assets;
    this.lastResourceKey = '';
    this.lastAffordKey = '';
    this.refreshCatalog();
  }

  setWelcome(visible: boolean): void {
    if (visible) {
      this.closePanels();
      this.diagnostics.hidden = true;
      this.diagnosticBtn.textContent = 'Diagnostik anzeigen';
    }
    this.welcome.classList.toggle('is-visible', visible);
    document.body.classList.toggle('is-welcome-open', visible);
    for (const peer of this.modalPeers) peer.inert = visible;
    if (visible) requestAnimationFrame(() => this.welcome.querySelector<HTMLButtonElement>('.is-welcome-start')?.focus());
  }

  private dismissWelcome(): void {
    this.welcome.classList.remove('is-visible');
    document.body.classList.remove('is-welcome-open');
    for (const peer of this.modalPeers) peer.inert = false;
  }

  toast(message: string, tone: 'neutral' | 'success' | 'warning' = 'neutral'): void {
    window.clearTimeout(this.toastTimer);
    this.toastEl.textContent = message;
    this.toastEl.dataset.tone = tone;
    this.toastEl.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('is-visible'), 2600);
  }

  setMode(mode: Mode): void {
    for (const [key, node] of this.modeButtons) node.classList.toggle('is-active', key === mode);
    for (const [key, node] of this.buildTiles) node.classList.toggle('is-active', key === mode);
    const type = BUILD_TYPE[mode];
    const entry = MODES.find((item) => item.mode === mode);
    this.mapBtn.classList.toggle('is-active', mode === Mode.Pan);
    this.buildBtn.classList.toggle('is-active', type !== undefined);
    const buildLabel = this.buildBtn.querySelector('span:nth-child(2)');
    if (buildLabel) buildLabel.textContent = type === undefined ? 'Bauen' : (entry?.label ?? 'Bauen');
    this.toast(mode === Mode.Pan ? 'Karte erkunden · Gebäude antippen für Details' : `Werkzeug: ${entry?.label ?? mode}`);
  }

  update(data: HudData): void {
    if (data.buildings > 0) this.dismissWelcome();
    this.updateResources(data);
    this.updateAffordable(data.affordable, data.availableGoods);
    this.updateObjective(data.objective);
    this.updateSelection(data.selection);
    for (const [value, node] of this.speedButtons) node.classList.toggle('is-active', value === (data.paused ? 0 : data.speed));
    this.updateDiagnostics(data);
    this.titleState.textContent = data.paused ? 'Pausiert' : `${data.population} Siedler · Tag ${Math.floor(data.tick / 1200) + 1}`;
  }

  private refreshCatalog(): void {
    this.catalogScroll.replaceChildren();
    this.buildTiles.clear();
    for (const chapter of CHAPTERS) {
      const section = el('section', 'is-chapter');
      section.innerHTML = `<h3>${chapter}</h3>`;
      const list = el('div', 'is-build-list');
      const entries = MODES
        .filter((entry) => entry.group === ModeGroup.Building)
        .sort((a, b) => Number(BUILD_TYPE[a.mode] !== BuildingType.Storehouse) - Number(BUILD_TYPE[b.mode] !== BuildingType.Storehouse));
      for (const entry of entries) {
        if (entry.group !== ModeGroup.Building) continue;
        const type = BUILD_TYPE[entry.mode];
        if (type === undefined || BUILD_META[type].chapter !== chapter) continue;
        const spec = BUILDING_SPECS[type];
        const tile = button('', () => { this.onMode(entry.mode); this.closePanels(); }, 'is-build-card');
        // Der alte grosse Hafen wurde wegen seiner eingebrannten
        // Wasserplatte aus dem Laufzeitmanifest entfernt. Bis seine vier
        // neuen Richtungsbilder fertig sind, zeigt auch der Katalog den
        // sauberen wasserfreien Richtungssteg statt eines leeren Feldes.
        const sprite = this.assets.buildings[type]?.[0]
          ?? (type === BuildingType.Harbor ? this.assets.smallHarbor.down : null);
        tile.classList.toggle('is-recommended', type === BuildingType.Storehouse);
        tile.dataset.label = entry.label;
        tile.innerHTML = `<span class="is-build-sprite">${sprite ? `<img src="${sprite.src}" alt="">` : '<i></i>'}</span><span class="is-build-copy"><span class="is-build-name"><strong>${entry.label}</strong>${type === BuildingType.Storehouse ? '<em>Empfohlen</em>' : ''}</span><small>${BUILD_META[type].description}</small><span class="is-cost">${this.costMarks(spec.cost)}</span><span class="is-missing" aria-live="polite"></span></span><kbd>${entry.key.toUpperCase()}</kbd>`;
        this.buildTiles.set(entry.mode, tile);
        list.append(tile);
      }
      section.append(list);
      this.catalogScroll.append(section);
    }
  }

  private goodMark(good: Good): string {
    const key = GOOD_ICON[good];
    const sprite = key ? this.assets.goods[key]?.[0] : undefined;
    return sprite ? `<img class="is-good-icon" src="${sprite.src}" alt="">` : `<i class="is-good-icon" style="--good:${GOOD_COLOR[good]}"></i>`;
  }

  private costMarks(cost: readonly number[]): string {
    const result: string[] = [];
    for (let good = 0; good < GOOD_COUNT; good++) if (cost[good] > 0) result.push(`<span>${this.goodMark(good as Good)}${cost[good]}</span>`);
    return result.length ? result.join('') : '<span class="is-free">ohne Kosten</span>';
  }

  private updateAffordable(affordable: Record<number, boolean>, availableGoods: readonly number[]): void {
    const key = Object.entries(affordable).map(([type, ok]) => type + Number(ok)).join() + `|${availableGoods.join(',')}`;
    if (key === this.lastAffordKey) return;
    this.lastAffordKey = key;
    for (const [mode, tile] of this.buildTiles) {
      const type = BUILD_TYPE[mode];
      if (type === undefined) continue;
      const ok = affordable[type] !== false;
      tile.classList.toggle('is-poor', !ok);
      tile.setAttribute('aria-disabled', String(!ok));
      const missing = BUILDING_SPECS[type].cost
        .map((amount, good) => ({ good: good as Good, amount: Math.max(0, amount - availableGoods[good]) }))
        .filter((item) => item.amount > 0)
        .map((item) => `${item.amount} ${missingGoodName(item.good, item.amount)}`);
      const missingText = ok ? '' : `Fehlt: ${missing.length ? missing.join(' · ') : 'Waren bereits verplant'}`;
      const missingNode = tile.querySelector('.is-missing');
      if (missingNode) missingNode.textContent = missingText;
      tile.title = missingText;
      tile.setAttribute('aria-label', ok ? `${tile.dataset.label}, bezahlbar` : `${tile.dataset.label}, ${missingText}`);
    }
  }

  private updateResources(data: HudData): void {
    const key = `${data.stock.stored.join(',')}|${data.stock.total.join(',')}|${data.population}/${data.workersNeeded}`;
    if (key === this.lastResourceKey) return;
    this.lastResourceKey = key;
    const nodes: string[] = [];
    const shortage = data.workersNeeded > data.population;
    nodes.push(`<div class="is-resource ${shortage ? 'is-alert' : ''}" title="${data.population} Siedler für ${data.workersNeeded} Arbeitsplätze"><i class="is-people"></i><span><b>${data.population}</b><small>Siedler</small></span><em>${data.workersNeeded} Arbeit</em></div>`);
    for (let index = 0; index < GOOD_COUNT; index++) {
      const good = index as Good;
      if (!CORE_GOODS.includes(good) && data.stock.total[index] === 0) continue;
      const bound = data.stock.total[index] - data.stock.stored[index];
      nodes.push(`<div class="is-resource" title="${GOOD_NAMES[good]}: ${data.stock.stored[index]} im Lager, ${bound} gebunden">${this.goodMark(good)}<span><b>${data.stock.stored[index]}</b><small>${GOOD_NAMES[good]}</small></span>${bound > 0 ? `<em>+${bound}</em>` : ''}</div>`);
    }
    this.resources.innerHTML = nodes.join('');
  }

  private updateObjective(objective: HudObjective): void {
    const key = `${objective.eyebrow}|${objective.title}|${objective.progress}`;
    if (key === this.lastObjectiveKey) return;
    this.lastObjectiveKey = key;
    this.objective.innerHTML = `<span class="is-kicker">${objective.eyebrow}</span><button class="is-objective-action" type="button"><strong>${objective.title}</strong><span>→</span></button><p>${objective.reason}</p><div class="is-progress"><i style="width:${Math.round(objective.progress * 100)}%"></i></div>`;
    this.objective.querySelector('button')?.addEventListener('click', () => {
      if (objective.actionMode) {
        this.onMode(objective.actionMode);
        this.closePanels();
      }
    });
  }

  private updateSelection(selection: HudSelection | null): void {
    const key = JSON.stringify(selection);
    if (key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;
    this.inspector.hidden = selection === null;
    if (!selection) return;
    this.inspector.innerHTML = `<span class="is-kicker">Auswahl</span><h2>${selection.title}</h2><p>${selection.subtitle}</p><dl>${selection.lines.map((line) => `<div><dt>${line.label}</dt><dd>${line.value}</dd></div>`).join('')}</dl>`;
  }

  private updateDiagnostics(data: HudData): void {
    if (this.diagnostics.hidden) return;
    const hover = data.hover ? `${data.hover.x}, ${data.hover.y} · ${data.hover.tile}` : '–';
    this.diagnostics.innerHTML = `<strong>Diagnostik</strong>${diag('Seed', data.seed)}${diag('Tick / FPS', `${data.tick} / ${data.fps.toFixed(0)}`)}${diag('Hash', data.hash)}${diag('Kamera', `${data.camX.toFixed(1)}, ${data.camY.toFixed(1)} · ${data.zoom.toFixed(1)} px`)}${diag('Cursor', hover)}${diag('Chunks', `${data.chunksCached}/${data.chunksGenerated} · ${data.chunksPending} offen`)}${diag('Objekte', `${data.buildings} Gebäude · ${data.carriers} Träger`)}${diag('Speicher', data.saved)}`;
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag); node.className = className; return node;
};
const button = (text: string, onClick: () => void, className: string): HTMLButtonElement => {
  const node = el('button', className); node.type = 'button'; node.textContent = text; node.addEventListener('click', onClick); return node;
};
const label = (text: string): HTMLElement => { const node = el('span', 'is-control-label'); node.textContent = text; return node; };
const diag = (labelText: string, value: string | number): string => `<div><span>${labelText}</span><code>${value}</code></div>`;
const missingGoodName = (good: Good, amount: number): string => (
  good === Good.Plank && amount === 1 ? 'Brett' : GOOD_NAMES[good]
);
