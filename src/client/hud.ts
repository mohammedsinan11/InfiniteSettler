/**
 * Bedienoberflaeche.
 *
 * Aufbau: eine schmale Leiste UNTEN in Daumenreichweite mit den vier
 * Dauerwerkzeugen, ein Bau-Overlay das sich nur auf Tippen oeffnet, und
 * ein duenner Warenstreifen oben. Die Karte behaelt damit den weitaus
 * groessten Teil der Flaeche - vorher belegte die Kopfleiste auf dem
 * Handy ein Drittel des Bildschirms.
 *
 * Die Icons sind die echten Spielsprites, nicht eigens gezeichnete
 * Symbole: der Knopf zeigt genau das Gebaeude, das danach auf der Karte
 * steht. Fuer Waren ohne Sprite (Fisch) faellt die Anzeige auf ein
 * farbiges Zeichen zurueck.
 */

import type { StockSummary } from '../sim/state';
import { BUILDING_SPECS, GOOD_COUNT, GOOD_NAMES, Good } from '../sim/types';
import type { GameAssets, GoodSprite } from './assets';
import { emptyGameAssets } from './assets';
import { GOOD_COLOR } from './colors';
import { BUILD_TYPE, ModeGroup, MODES, Mode } from './input';

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
  /** Welche Bauarten gerade bezahlbar sind - kommt aus der Simulation. */
  affordable: Record<number, boolean>;
  seed: number;
  saved: string;
  /** Ankerkachel der eigenen Siedlung, oder null wenn noch nichts steht. */
  home: { x: number; y: number } | null;
}

/** Welche Ware welches Sprite bekommt. Nicht jede hat eines. */
const GOOD_ICON: Partial<Record<Good, GoodSprite>> = {
  [Good.Wood]: 'wood',
  [Good.Plank]: 'plank',
  [Good.Stone]: 'stone',
};

const NARROW = 720;

export class Hud {
  private assets: GameAssets = emptyGameAssets();
  private res: HTMLDivElement;
  private status: HTMLDivElement;
  private sheet: HTMLDivElement;
  private admin: HTMLDivElement;
  private readonly buildBtn: HTMLButtonElement;
  private detailBtn: HTMLButtonElement;
  private buttons = new Map<Mode, HTMLButtonElement>();
  private showDetails = window.innerWidth >= NARROW;
  private lastResKey = '';
  private lastAffordKey = '';

  private compass: HTMLButtonElement;
  private compassArrow: HTMLElement;
  private compassText: HTMLElement;

  constructor(
    private onMode: (m: Mode) => void,
    onNewWorld: () => void,
    onReset: () => void,
    onRecenter: () => void,
  ) {
    injectStyles();

    this.buildBtn = this.makeBuildButton();
    this.res = el('div', 'is-res');
    this.status = el('div', 'is-status');
    this.sheet = el('div', 'is-sheet');
    this.admin = el('div', 'is-admin');

    // --- Bau-Overlay -------------------------------------------------
    for (const entry of MODES) {
      if (entry.group !== ModeGroup.Building) continue;
      const tile = document.createElement('button');
      tile.className = 'is-tile';
      tile.addEventListener('click', () => {
        this.onMode(entry.mode);
        this.closeSheet();
      });
      this.sheet.appendChild(tile);
      this.buttons.set(entry.mode, tile);
    }

    // --- Untere Leiste -----------------------------------------------
    const bar = el('div', 'is-bar');
    for (const entry of MODES) {
      if (entry.group === ModeGroup.Building) continue;
      const b = document.createElement('button');
      b.className = 'is-btn';
      b.textContent = entry.label;
      b.title = `Taste ${entry.key}`;
      b.addEventListener('click', () => {
        this.onMode(entry.mode);
        this.closeSheet();
      });
      this.buttons.set(entry.mode, b);
      bar.appendChild(b);
      // "Bauen" sitzt zwischen Strasse und Abreissen.
      if (entry.mode === Mode.Road) bar.appendChild(this.buildBtn);
    }

    const more = document.createElement('button');
    more.className = 'is-btn is-alt';
    more.textContent = '⋯';
    more.title = 'Mehr';
    more.addEventListener('click', () => this.admin.classList.toggle('is-open'));
    bar.appendChild(more);

    this.detailBtn = mkButton('Details', () => this.toggleDetails());
    this.admin.appendChild(this.detailBtn);
    this.admin.appendChild(mkButton('Neue Welt', onNewWorld));
    this.admin.appendChild(mkButton('Spielstand loeschen', onReset));

    // Kompass: auf einer unendlichen Karte verliert man die eigene
    // Siedlung sonst und findet sie nie wieder. Der Pfeil zeigt dorthin,
    // ein Tipp springt hin.
    this.compass = document.createElement('button');
    this.compass.className = 'is-compass';
    this.compass.title = 'Zur Siedlung';
    this.compassArrow = el('span', 'is-needle');
    this.compassText = el('span', 'is-dist');
    this.compass.append(this.compassArrow, this.compassText);
    this.compass.addEventListener('click', onRecenter);

    document.body.append(this.res, this.status, this.sheet, this.admin, this.compass, bar);
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'i') this.toggleDetails();
    });
    this.applyDetails();
    this.refreshTiles();
  }

  private makeBuildButton(): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'is-btn is-build';
    b.innerHTML = '<span class="is-build-label">Bauen</span>';
    b.addEventListener('click', () => {
      this.sheet.classList.toggle('is-open');
      this.admin.classList.remove('is-open');
    });
    return b;
  }

  private closeSheet(): void {
    this.sheet.classList.remove('is-open');
    this.admin.classList.remove('is-open');
  }

  setAssets(assets: GameAssets): void {
    this.assets = assets;
    this.lastResKey = '';
    this.lastAffordKey = '';
    this.refreshTiles();
  }

  /** Icons der Bau-Kacheln aus den geladenen Sprites aufbauen. */
  private refreshTiles(): void {
    for (const entry of MODES) {
      if (entry.group !== ModeGroup.Building) continue;
      const tile = this.buttons.get(entry.mode);
      const type = BUILD_TYPE[entry.mode];
      if (!tile || type === undefined) continue;
      const sprite = this.assets.buildings[type]?.[0];
      tile.innerHTML =
        (sprite ? `<img src="${sprite.src}" alt="">` : '<span class="is-noicon"></span>') +
        `<span class="is-tile-name">${entry.label}</span>` +
        `<span class="is-tile-cost">${this.costMarks(BUILDING_SPECS[type].cost)}</span>`;
    }
  }

  private goodMark(good: Good): string {
    const key = GOOD_ICON[good];
    const sprite = key ? this.assets.goods[key]?.[0] : undefined;
    return sprite
      ? `<img class="is-mark" src="${sprite.src}" alt="">`
      : `<i class="is-mark" style="background:${GOOD_COLOR[good]}"></i>`;
  }

  private costMarks(cost: readonly number[]): string {
    const parts: string[] = [];
    for (let g = 0; g < GOOD_COUNT; g++) {
      if (cost[g] > 0) parts.push(this.goodMark(g as Good) + cost[g]);
    }
    return parts.length === 0 ? '<span class="is-free">gratis</span>' : parts.join('');
  }

  setMode(m: Mode): void {
    for (const [mode, btn] of this.buttons) btn.classList.toggle('is-active', mode === m);
    // Der Bauen-Knopf zeigt an, welches Gebaeude gerade gewaehlt ist.
    const type = BUILD_TYPE[m];
    const active = type !== undefined;
    this.buildBtn.classList.toggle('is-active', active);
    const sprite = active ? this.assets.buildings[type]?.[0] : undefined;
    const label = active
      ? (MODES.find((e) => e.mode === m)?.label ?? 'Bauen')
      : 'Bauen';
    this.buildBtn.innerHTML =
      (sprite ? `<img class="is-build-icon" src="${sprite.src}" alt="">` : '') +
      `<span class="is-build-label">${label}</span>`;
  }

  private toggleDetails(): void {
    this.showDetails = !this.showDetails;
    this.applyDetails();
  }

  private applyDetails(): void {
    this.status.hidden = !this.showDetails;
    this.detailBtn.classList.toggle('is-active', this.showDetails);
  }

  update(d: HudData): void {
    this.updateResources(d.stock);
    this.updateAffordable(d.affordable);
    this.updateCompass(d);
    if (this.showDetails) this.updateStatus(d);
  }

  /**
   * Bauten ausgrauen, die man sich gerade nicht leisten kann.
   *
   * Ohne das passiert beim Tippen einfach nichts - der Command wird
   * stillschweigend verworfen, und man sucht den Fehler auf der Karte.
   */
  private updateAffordable(affordable: Record<number, boolean>): void {
    const key = Object.entries(affordable).map(([k, v]) => k + (v ? '1' : '0')).join();
    if (key === this.lastAffordKey) return;
    this.lastAffordKey = key;

    for (const entry of MODES) {
      if (entry.group !== ModeGroup.Building) continue;
      const tile = this.buttons.get(entry.mode);
      const type = BUILD_TYPE[entry.mode];
      if (!tile || type === undefined) continue;
      const ok = affordable[type] !== false;
      tile.classList.toggle('is-poor', !ok);
      tile.title = ok ? '' : 'Nicht genug im Lager';
    }
  }

  private updateCompass(d: HudData): void {
    if (!d.home) {
      this.compass.hidden = true;
      return;
    }
    const dx = d.home.x - d.camX;
    const dy = d.home.y - d.camY;
    const dist = Math.hypot(dx, dy);
    this.compass.hidden = false;
    // Steht man praktisch schon da, zeigt der Pfeil nur noch herum -
    // dann lieber einen Punkt.
    if (dist < 3) {
      this.compassArrow.style.transform = 'none';
      this.compassArrow.classList.add('is-here');
      this.compassText.textContent = 'hier';
      return;
    }
    this.compassArrow.classList.remove('is-here');
    // atan2 zaehlt gegen den Uhrzeigersinn ab der x-Achse, CSS dreht im
    // Uhrzeigersinn ab "oben" - daher der Versatz um 90 Grad.
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    this.compassArrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    this.compassText.textContent =
      dist >= 1000 ? `${(dist / 1000).toFixed(1)}k` : `${Math.round(dist)}`;
  }

  private updateResources(s: StockSummary): void {
    const key = s.stored.join(',') + '|' + s.total.join(',');
    if (key === this.lastResKey) return;
    this.lastResKey = key;

    const cards: string[] = [];
    for (let g = 0; g < GOOD_COUNT; g++) {
      const good = g as Good;
      const bound = s.total[g] - s.stored[g];
      const title =
        `${GOOD_NAMES[good]}: ${s.stored[g]} im Lager, ` +
        `${s.buffered[g]} in Gebaeuden, ${s.inTransit[g]} unterwegs`;
      cards.push(
        `<div class="is-card" title="${title}">${this.goodMark(good)}` +
          `<span class="is-card-n">${s.stored[g]}</span>` +
          (bound > 0 ? `<span class="is-card-sub">+${bound}</span>` : '') +
          '</div>',
      );
    }
    this.res.innerHTML = cards.join('');
  }

  private updateStatus(d: HudData): void {
    const hover = d.hover ? `${d.hover.x}, ${d.hover.y} (${d.hover.tile})` : '-';
    this.status.innerHTML = [
      row('Seed', String(d.seed)),
      row('Tick', `${d.tick} &middot; ${d.fps.toFixed(0)} FPS`),
      row('Hash', `<span class="is-hash">${d.hash}</span>`),
      row('Kamera', `${d.camX.toFixed(1)}, ${d.camY.toFixed(1)} &middot; ${d.zoom.toFixed(1)} px/Tile`),
      row('Cursor', hover),
      row('Chunks', `${d.chunksCached} / ${d.chunksGenerated}` +
        (d.chunksPending > 0 ? ` &middot; ${d.chunksPending} offen` : '')),
      row('Welt', `${d.buildings} Gebaeude &middot; ${d.carriers} Traeger`),
      row('Speicher', d.saved),
    ].join('');
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) => {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
};

function mkButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'is-btn is-alt';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

const row = (k: string, v: string): string =>
  `<div class="is-row"><span>${k}</span><span>${v}</span></div>`;

function injectStyles(): void {
  const css = document.createElement('style');
  css.textContent = `
    .is-bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 3;
      display: flex; gap: 6px; padding: 8px;
      justify-content: center; flex-wrap: wrap;
      background: rgba(12,18,24,0.86);
      border-top: 1px solid rgba(255,255,255,0.10);
      backdrop-filter: blur(6px);
      padding-bottom: max(8px, env(safe-area-inset-bottom));
    }
    .is-btn {
      font: inherit; color: #cfd8e3; background: #1b2833;
      border: 1px solid rgba(255,255,255,0.10); border-radius: 6px;
      padding: 9px 14px; min-height: 42px; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .is-btn:hover { background: #24343f; }
    .is-btn.is-active { background: #33608c; border-color: #5b93c4; color: #fff; }
    .is-btn.is-alt { color: #9aa7b4; }
    .is-build-icon { height: 26px; image-rendering: pixelated; }

    /* Bau-Overlay: nur auf Tippen sichtbar, direkt ueber der Leiste. */
    .is-sheet {
      position: fixed; left: 8px; right: 8px; bottom: 68px; z-index: 3;
      display: none; gap: 6px; flex-wrap: wrap; justify-content: center;
      padding: 8px; border-radius: 10px;
      background: rgba(12,18,24,0.94);
      border: 1px solid rgba(255,255,255,0.12);
      backdrop-filter: blur(8px);
    }
    .is-sheet.is-open { display: flex; }
    .is-tile {
      font: inherit; color: #cfd8e3; background: #1b2833;
      border: 1px solid rgba(255,255,255,0.10); border-radius: 8px;
      padding: 8px 6px 6px; width: 104px; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 2px;
    }
    .is-tile:hover { background: #24343f; }
    .is-tile.is-active { background: #33608c; border-color: #5b93c4; color: #fff; }
    .is-tile img { height: 46px; image-rendering: pixelated; }
    .is-noicon { height: 46px; }
    .is-tile-name { font-size: 12px; }
    .is-tile-cost { font-size: 11px; color: #9fb0c0; display: flex; align-items: center; gap: 2px; }
    .is-free { color: #7fd1a5; }
    .is-tile.is-poor { opacity: 0.42; }
    .is-tile.is-poor .is-tile-cost { color: #d98b8b; }

    .is-admin {
      position: fixed; left: 8px; right: 8px; bottom: 68px; z-index: 4;
      display: none; gap: 6px; flex-wrap: wrap; justify-content: center;
      padding: 8px; border-radius: 10px;
      background: rgba(12,18,24,0.94);
      border: 1px solid rgba(255,255,255,0.12);
    }
    .is-admin.is-open { display: flex; }

    /* Warenstreifen oben - schmal und immer sichtbar. */
    .is-res {
      position: fixed; top: 0; right: 0; z-index: 2;
      display: flex; gap: 4px; padding: 6px;
    }
    .is-card {
      display: flex; align-items: center; gap: 4px;
      padding: 4px 8px; border-radius: 6px;
      background: rgba(12,18,24,0.86);
      border: 1px solid rgba(255,255,255,0.10);
      backdrop-filter: blur(6px); cursor: default;
    }
    .is-mark {
      width: 16px; height: 16px; border-radius: 2px; flex: 0 0 auto;
      image-rendering: pixelated; object-fit: contain;
    }
    i.is-mark { box-shadow: inset 0 0 0 1px rgba(0,0,0,0.45); }
    .is-card-n { font-size: 14px; font-weight: 700; color: #f0f4f8;
                 font-variant-numeric: tabular-nums; }
    .is-card-sub { color: #6f8497; font-size: 11px; }

    .is-status {
      position: fixed; left: 8px; top: 8px; z-index: 2;
      padding: 8px 10px; min-width: 260px;
      background: rgba(12,18,24,0.82);
      border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
      backdrop-filter: blur(6px); pointer-events: none;
    }
    .is-row { display: flex; gap: 12px; justify-content: space-between; }
    .is-row span:first-child { color: #7f8c99; }
    .is-hash { color: #7fd1a5; }

    .is-compass {
      position: fixed; right: 10px; bottom: 70px; z-index: 3;
      width: 54px; height: 54px; border-radius: 50%;
      background: rgba(12,18,24,0.86);
      border: 1px solid rgba(255,255,255,0.14);
      backdrop-filter: blur(6px); cursor: pointer;
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 1px; padding: 0;
      color: #cfd8e3; font: inherit;
    }
    .is-compass:hover { background: #24343f; }
    .is-needle {
      width: 0; height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-bottom: 15px solid #e8b04b;
      transition: transform 0.12s linear;
    }
    .is-needle.is-here {
      border: none; width: 9px; height: 9px; border-radius: 50%;
      background: #7fd1a5;
    }
    .is-dist { font-size: 10px; color: #93a1af; font-variant-numeric: tabular-nums; }
    .is-compass[hidden] { display: none; }

    @media (pointer: coarse) { .is-btn { min-height: 46px; } }
    @media (max-width: 720px) {
      .is-btn { padding: 9px 10px; }
      .is-tile { width: 88px; }
      .is-tile img { height: 38px; }
      .is-status { display: none; }
    }
  `;
  document.head.appendChild(css);
}
