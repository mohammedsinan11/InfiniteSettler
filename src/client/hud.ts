/**
 * Overlay: Werkzeugleiste, Warenanzeige und Detailfeld.
 *
 * Die Warenanzeige ist bewusst ein eigenes Element und nicht Teil des
 * Detailfelds. Vorher steckte sie als eine Zeile unter lauter Debugwerten -
 * und verschwand unterhalb von 640 px Breite komplett mit, weil das ganze
 * Feld ausgeblendet wurde. Die wichtigste Zahl des Spiels war damit auf
 * schmalen Fenstern unsichtbar.
 *
 * Der Zustands-Hash im Detailfeld ist kein Debug-Beiwerk, sondern die
 * Vorbereitung auf M5: zwei Clients mit gleichem Seed und gleicher
 * Befehlsfolge muessen denselben Hash zeigen.
 */

import type { StockSummary } from '../sim/state';
import { GOOD_NAMES, type Good } from '../sim/types';
import { GOOD_COLOR } from './colors';
import { MODE_LABELS, type Mode } from './input';

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
  seed: number;
  saved: string;
}

/** Unterhalb dieser Breite startet das Detailfeld eingeklappt. */
const NARROW = 720;

export class Hud {
  private status: HTMLDivElement;
  private res: HTMLDivElement;
  private detailBtn: HTMLButtonElement;
  private buttons = new Map<Mode, HTMLButtonElement>();
  private showDetails = window.innerWidth >= NARROW;
  /** Zuletzt gerenderte Warenzeile - spart DOM-Arbeit pro Frame. */
  private lastResKey = '';

  constructor(
    onMode: (m: Mode) => void,
    onNewWorld: () => void,
    onReset: () => void,
  ) {
    injectStyles();

    const bar = document.createElement('div');
    bar.className = 'is-bar';
    for (const [mode, key, label] of MODE_LABELS) {
      const b = document.createElement('button');
      b.className = 'is-btn';
      b.innerHTML = `<b>${key}</b> ${label}`;
      b.addEventListener('click', () => onMode(mode));
      bar.appendChild(b);
      this.buttons.set(mode, b);
    }

    const spacer = document.createElement('span');
    spacer.className = 'is-spacer';
    bar.appendChild(spacer);

    this.detailBtn = mkButton('Details', () => this.toggleDetails());
    bar.appendChild(this.detailBtn);
    bar.appendChild(mkButton('Neue Welt', onNewWorld));
    bar.appendChild(mkButton('Spielstand loeschen', onReset));

    this.res = document.createElement('div');
    this.res.className = 'is-res';

    this.status = document.createElement('div');
    this.status.className = 'is-status';

    // Beides in einen Container: sobald die Werkzeugleiste umbricht, wuerde
    // eine separat positionierte Warenanzeige darueberliegen.
    const top = document.createElement('div');
    top.className = 'is-top';
    top.appendChild(bar);
    top.appendChild(this.res);

    document.body.appendChild(top);
    document.body.appendChild(this.status);

    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'i') this.toggleDetails();
    });

    this.applyDetails();
  }

  setMode(m: Mode): void {
    for (const [mode, btn] of this.buttons) {
      btn.classList.toggle('is-active', mode === m);
    }
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
    if (this.showDetails) this.updateStatus(d);
  }

  private updateResources(s: StockSummary): void {
    // Nur neu bauen, wenn sich wirklich eine Zahl geaendert hat.
    const key = s.stored.join(',') + '|' + s.total.join(',');
    if (key === this.lastResKey) return;
    this.lastResKey = key;

    const cards: string[] = [];
    for (let g = 0; g < s.stored.length; g++) {
      const good = g as Good;
      const bound = s.total[g] - s.stored[g];
      const title =
        `${s.stored[g]} im Lager, ${s.buffered[g]} in Gebaeuden, ` +
        `${s.inTransit[g]} unterwegs`;
      cards.push(
        `<div class="is-card" title="${title}">` +
          `<i style="background:${GOOD_COLOR[good]}"></i>` +
          `<span class="is-card-name">${GOOD_NAMES[good]}</span>` +
          `<span class="is-card-n">${s.stored[g]}</span>` +
          (bound > 0 ? `<span class="is-card-sub">+${bound}</span>` : '') +
          `</div>`,
      );
    }
    this.res.innerHTML = cards.join('');
  }

  private updateStatus(d: HudData): void {
    const hover = d.hover ? `${d.hover.x}, ${d.hover.y} (${d.hover.tile})` : '-';
    this.status.innerHTML = [
      row('Seed', String(d.seed)),
      row('Tick', `${d.tick}  &middot;  ${d.fps.toFixed(0)} FPS`),
      row('Hash', `<span class="is-hash">${d.hash}</span>`),
      row(
        'Kamera',
        `${d.camX.toFixed(1)}, ${d.camY.toFixed(1)}  &middot;  ${d.zoom.toFixed(1)} px/Tile`,
      ),
      row('Cursor', hover),
      row(
        'Chunks',
        `${d.chunksCached} im Cache &middot; ${d.chunksGenerated} erzeugt` +
          (d.chunksPending > 0 ? ` &middot; ${d.chunksPending} offen` : ''),
      ),
      row('Welt', `${d.buildings} Gebaeude &middot; ${d.carriers} Traeger`),
      row('Speicher', d.saved),
    ].join('');
  }
}

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
    .is-top {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2;
      background: rgba(12,18,24,0.82);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      backdrop-filter: blur(6px);
    }
    .is-bar {
      display: flex; gap: 6px; padding: 8px 8px 0;
      flex-wrap: wrap; align-items: center;
    }
    .is-spacer { flex: 1 1 auto; }
    .is-btn {
      font: inherit; color: #cfd8e3; background: #1b2833;
      border: 1px solid rgba(255,255,255,0.10); border-radius: 5px;
      padding: 5px 10px; cursor: pointer;
    }
    .is-btn:hover { background: #24343f; }
    .is-btn b { color: #8fb4d9; margin-right: 3px; }
    .is-btn.is-active { background: #33608c; border-color: #5b93c4; color: #fff; }
    .is-btn.is-alt { color: #9aa7b4; }

    /* Warenanzeige: immer sichtbar, auf jeder Fenstergroesse. */
    .is-res {
      display: flex; gap: 6px; padding: 8px; flex-wrap: wrap;
    }
    .is-card {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px; min-width: 108px;
      background: rgba(12,18,24,0.86);
      border: 1px solid rgba(255,255,255,0.10); border-radius: 6px;
      backdrop-filter: blur(6px); cursor: default;
    }
    .is-card i {
      width: 11px; height: 11px; border-radius: 2px; flex: 0 0 auto;
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.45);
    }
    .is-card-name { color: #93a1af; }
    .is-card-n {
      margin-left: auto; font-size: 15px; font-weight: 700; color: #f0f4f8;
      font-variant-numeric: tabular-nums;
    }
    .is-card-sub { color: #6f8497; font-size: 11px; }

    .is-status {
      position: fixed; left: 8px; bottom: 8px; min-width: 300px;
      padding: 8px 10px; background: rgba(12,18,24,0.82);
      border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
      backdrop-filter: blur(6px); pointer-events: none; z-index: 2;
    }
    .is-row { display: flex; gap: 12px; justify-content: space-between; }
    .is-row span:first-child { color: #7f8c99; }
    .is-hash { color: #7fd1a5; }

    @media (max-width: 720px) {
      /* Nur das Detailfeld schrumpft - die Warenanzeige bleibt. */
      .is-status { min-width: 0; right: 8px; }
      .is-card { min-width: 96px; }
    }
  `;
  document.head.appendChild(css);
}
