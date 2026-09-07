/**
 * Overlay: Werkzeugleiste und Statuszeile.
 *
 * Der Zustands-Hash ist hier kein Debug-Beiwerk, sondern die Vorbereitung
 * auf M5: zwei Clients mit gleichem Seed und gleicher Befehlsfolge muessen
 * denselben Hash zeigen. Weicht er ab, sind sie auseinandergelaufen.
 */

import { GOOD_NAMES, type Good } from '../sim/types';
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
  stock: number[];
  seed: number;
  saved: string;
}

export class Hud {
  private status: HTMLDivElement;
  private buttons = new Map<Mode, HTMLButtonElement>();

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

    const newBtn = document.createElement('button');
    newBtn.className = 'is-btn is-alt';
    newBtn.textContent = 'Neue Welt';
    newBtn.addEventListener('click', onNewWorld);
    bar.appendChild(newBtn);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'is-btn is-alt';
    resetBtn.textContent = 'Spielstand loeschen';
    resetBtn.addEventListener('click', onReset);
    bar.appendChild(resetBtn);

    this.status = document.createElement('div');
    this.status.className = 'is-status';

    document.body.appendChild(bar);
    document.body.appendChild(this.status);
  }

  setMode(m: Mode): void {
    for (const [mode, btn] of this.buttons) {
      btn.classList.toggle('is-active', mode === m);
    }
  }

  update(d: HudData): void {
    const stock = d.stock
      .map((n, g) => `${GOOD_NAMES[g as Good]} ${n}`)
      .join('  ');
    const hover = d.hover
      ? `${d.hover.x}, ${d.hover.y} (${d.hover.tile})`
      : '-';

    this.status.innerHTML = [
      row('Seed', String(d.seed)),
      row('Tick', `${d.tick}  ·  ${d.fps.toFixed(0)} FPS`),
      row('Hash', `<span class="is-hash">${d.hash}</span>`),
      row('Kamera', `${d.camX.toFixed(1)}, ${d.camY.toFixed(1)}  ·  ${d.zoom.toFixed(1)} px/Tile`),
      row('Cursor', hover),
      row(
        'Chunks',
        `${d.chunksCached} im Cache · ${d.chunksGenerated} erzeugt` +
          (d.chunksPending > 0 ? ` · ${d.chunksPending} offen` : ''),
      ),
      row('Welt', `${d.buildings} Gebaeude · ${d.carriers} Traeger`),
      row('Lager', stock),
      row('Speicher', d.saved),
    ].join('');
  }
}

const row = (k: string, v: string): string =>
  `<div class="is-row"><span>${k}</span><span>${v}</span></div>`;

function injectStyles(): void {
  const css = document.createElement('style');
  css.textContent = `
    .is-bar {
      position: fixed; top: 0; left: 0; right: 0; display: flex; gap: 6px;
      padding: 8px; background: rgba(12,18,24,0.82);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      backdrop-filter: blur(6px); flex-wrap: wrap; align-items: center;
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
    .is-status {
      position: fixed; left: 8px; bottom: 8px; min-width: 300px;
      padding: 8px 10px; background: rgba(12,18,24,0.82);
      border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
      backdrop-filter: blur(6px); pointer-events: none;
    }
    .is-row { display: flex; gap: 12px; justify-content: space-between; }
    .is-row span:first-child { color: #7f8c99; }
    .is-hash { color: #7fd1a5; }
    @media (max-width: 640px) { .is-status { display: none; } }
  `;
  document.head.appendChild(css);
}
