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
  /** Siedler insgesamt und wieviele davon gerade gebraucht werden. */
  population: number;
  workersNeeded: number;
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
  [Good.Fish]: 'fish',
  [Good.Grain]: 'grain',
  [Good.Flour]: 'flour',
  [Good.Bread]: 'bread',
};

/**
 * Waren, die immer angezeigt werden.
 *
 * Die uebrigen erscheinen erst, wenn es sie gibt. Sieben Kacheln von
 * Anfang an waeren auf dem Handy nicht mehr lesbar, und Mehl anzuzeigen,
 * bevor eine Muehle steht, hilft niemandem.
 */
const CORE_GOODS: readonly Good[] = [Good.Wood, Good.Plank, Good.Stone, Good.Fish];

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
      // Vorstufen benutzen das Bild ihrer Ausbaustufe. Damit die beiden
      // Kacheln im Menue nicht identisch aussehen, wird das Icon genauso
      // verkleinert wie das Gebaeude auf der Karte.
      const scale = BUILDING_SPECS[type].spriteScale;
      const style = scale === 1 ? '' : ` style="width:${Math.round(scale * 100)}%"`;
      tile.innerHTML =
        (sprite ? `<img src="${sprite.src}"${style} alt="">` : '<span class="is-noicon"></span>') +
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
    this.updateResources(d);
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

  private updateResources(d: HudData): void {
    const s = d.stock;
    const key =
      s.stored.join(',') + '|' + s.total.join(',') +
      '|' + d.population + '/' + d.workersNeeded;
    if (key === this.lastResKey) return;
    this.lastResKey = key;

    // Einwohner zuerst: sie sind die Groesse, an der alles haengt.
    const short = d.workersNeeded > d.population;
    const cards: string[] = [
      `<div class="is-card${short ? ' is-short' : ''}" title="${
        short
          ? `Zu wenig Siedler: ${d.workersNeeded} Arbeitsplaetze, nur ${d.population} Siedler. ` +
            'Die zuletzt gebauten Betriebe stehen still.'
          : `${d.population} Siedler, ${d.workersNeeded} davon in Arbeit`
      }"><i class="is-mark is-people"></i>` +
        `<span class="is-card-n">${d.population}</span>` +
        `<span class="is-card-sub">/${d.workersNeeded}</span></div>`,
    ];
    for (let g = 0; g < GOOD_COUNT; g++) {
      const good = g as Good;
      if (!CORE_GOODS.includes(good) && s.total[g] === 0) continue;
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
    /*
     * Holz und Pergament statt dunklem Blaugrau.
     *
     * Die vorige Fassung war ein glasiger Dunkelmodus - technisch sauber,
     * aber aus einer anderen Welt als die Sprites. Die Farben hier sind
     * dieselben, die auch in den Gebaeuden vorkommen: Balkenbraun,
     * Strohgelb, Dachziegelrot. Serifenschrift statt Monospace aus
     * demselben Grund; Zahlen bleiben tabellarisch, damit sie beim
     * Hochzaehlen nicht springen.
     */
    :root {
      --holz-dunkel: #2b1f15;
      --holz: #4a3626;
      --holz-hell: #6d5138;
      --pergament: #e6d7b4;
      --pergament-tief: #cbb98f;
      --tinte: #3a2b1a;
      --gold: #c8952a;
    }

    .is-bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 3;
      display: flex; gap: 6px; padding: 8px;
      justify-content: center; flex-wrap: wrap;
      background: linear-gradient(180deg, #3a2b1d 0%, var(--holz-dunkel) 100%);
      border-top: 3px solid var(--holz-hell);
      box-shadow: 0 -2px 0 rgba(0,0,0,0.35);
      padding-bottom: max(8px, env(safe-area-inset-bottom));
      font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    }
    .is-btn {
      font: inherit; font-size: 14px; color: var(--tinte);
      background: linear-gradient(180deg, var(--pergament) 0%, var(--pergament-tief) 100%);
      border: 2px solid var(--holz-hell); border-radius: 4px;
      padding: 8px 14px; min-height: 42px; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.45);
      text-shadow: 0 1px 0 rgba(255,255,255,0.35);
    }
    .is-btn:hover { background: #f0e4c6; }
    .is-btn.is-active {
      background: linear-gradient(180deg, #e8bf62 0%, var(--gold) 100%);
      border-color: #8a6410; color: #2b1f0a;
    }
    .is-btn.is-alt { color: #5b452c; }
    .is-build-icon { height: 26px; image-rendering: pixelated; }

    .is-sheet, .is-admin {
      position: fixed; left: 8px; right: 8px; bottom: 70px; z-index: 3;
      display: none; gap: 6px; flex-wrap: wrap; justify-content: center;
      padding: 10px; border-radius: 6px;
      background: linear-gradient(180deg, #3a2b1d 0%, var(--holz-dunkel) 100%);
      border: 3px solid var(--holz-hell);
      box-shadow: 0 6px 18px rgba(0,0,0,0.45);
      font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    }
    .is-admin { z-index: 4; }
    .is-sheet.is-open, .is-admin.is-open { display: flex; }

    .is-tile {
      font: inherit; color: var(--tinte);
      background: linear-gradient(180deg, var(--pergament) 0%, var(--pergament-tief) 100%);
      border: 2px solid var(--holz-hell); border-radius: 5px;
      padding: 8px 6px 6px; width: 108px; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.45);
    }
    .is-tile:hover { background: #f0e4c6; }
    .is-tile.is-active {
      background: linear-gradient(180deg, #e8bf62 0%, var(--gold) 100%);
      border-color: #8a6410;
    }
    .is-tile img { height: 52px; image-rendering: pixelated; }
    .is-noicon { height: 52px; }
    .is-tile-name { font-size: 13px; }
    .is-tile-cost { font-size: 12px; color: #5b452c; display: flex; align-items: center; gap: 2px; }
    .is-free { color: #4a7a35; font-style: italic; }
    .is-tile.is-poor { opacity: 0.45; }
    .is-tile.is-poor .is-tile-cost { color: #9c3b2e; }

    .is-res {
      position: fixed; top: 0; right: 0; z-index: 2;
      display: flex; gap: 5px; padding: 6px;
      font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    }
    .is-card {
      display: flex; align-items: center; gap: 5px;
      padding: 4px 9px; border-radius: 4px;
      background: linear-gradient(180deg, var(--pergament) 0%, var(--pergament-tief) 100%);
      border: 2px solid var(--holz-hell); cursor: default;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.45);
    }
    .is-mark {
      width: 18px; height: 18px; flex: 0 0 auto;
      image-rendering: pixelated; object-fit: contain;
    }
    i.is-mark { border-radius: 2px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.45); }
    /* Siedler: zwei Koepfe als Andeutung, bis es ein Symbol dafuer gibt. */
    i.is-people {
      border-radius: 50%; background: #8a6a44;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.45), 6px -3px 0 -3px #8a6a44,
                  6px -3px 0 -2px rgba(0,0,0,0.35);
    }
    /* Zu wenig Siedler: die Kachel meldet sich, sonst sucht man den
       Grund fuer stehende Betriebe auf der Karte. */
    .is-card.is-short { background: #f3d9c0; box-shadow: inset 0 0 0 2px #b4522f; }
    .is-card.is-short .is-card-sub { color: #b4522f; font-weight: 700; }
    .is-card-n { font-size: 15px; font-weight: 700; color: var(--tinte);
                 font-variant-numeric: tabular-nums; }
    .is-card-sub { color: #7a6242; font-size: 11px; }

    .is-compass {
      position: fixed; right: 10px; bottom: 74px; z-index: 3;
      width: 54px; height: 54px; border-radius: 50%;
      background: radial-gradient(circle at 40% 35%, #f0e4c6 0%, var(--pergament-tief) 75%);
      border: 3px solid var(--holz-hell); cursor: pointer;
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 1px; padding: 0;
      color: var(--tinte); font-family: Georgia, serif;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
    .is-compass:hover { background: #f4e9cf; }
    .is-needle {
      width: 0; height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-bottom: 15px solid #9c3b2e;
      transition: transform 0.12s linear;
    }
    .is-needle.is-here {
      border: none; width: 9px; height: 9px; border-radius: 50%;
      background: #4a7a35;
    }
    .is-dist { font-size: 10px; color: #6b5236; font-variant-numeric: tabular-nums; }
    .is-compass[hidden] { display: none; }

    .is-status {
      position: fixed; left: 8px; top: 8px; z-index: 2;
      padding: 8px 10px; min-width: 260px;
      background: rgba(43,31,21,0.88);
      border: 2px solid var(--holz-hell); border-radius: 4px;
      color: var(--pergament); pointer-events: none;
      font: 12px/1.5 ui-monospace, Menlo, monospace;
    }
    .is-row { display: flex; gap: 12px; justify-content: space-between; }
    .is-row span:first-child { color: #a08a68; }
    .is-hash { color: var(--gold); }

    @media (pointer: coarse) { .is-btn { min-height: 46px; } }
    @media (max-width: 720px) {
      .is-btn { padding: 8px 10px; font-size: 13px; }
      .is-tile { width: 92px; }
      .is-tile img { height: 42px; }
      .is-status { display: none; }
    }
  `;
  document.head.appendChild(css);
}
