/**
 * Eingabe. Erzeugt ausschliesslich Commands - nie direkte Zustandsaenderungen.
 *
 * Genau diese Warteschlange wird in M5 zur Netzwerkschnittstelle: statt die
 * Commands sofort auszufuehren, gehen sie dann mit ein paar Ticks Verzoegerung
 * ueber die Leitung und werden bei allen Clients gleichzeitig angewendet.
 */

import type { Command } from '../sim/commands';
import { BuildingType } from '../sim/types';
import type { Camera } from './camera';

export const Mode = {
  Pan: 'pan',
  Road: 'road',
  Woodcutter: 'woodcutter',
  Sawmill: 'sawmill',
  Storehouse: 'storehouse',
  Demolish: 'demolish',
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export const MODE_LABELS: Array<[Mode, string, string]> = [
  [Mode.Pan, '1', 'Ansehen'],
  [Mode.Road, '2', 'Strasse'],
  [Mode.Woodcutter, '3', 'Holzfaeller'],
  [Mode.Sawmill, '4', 'Saegewerk'],
  [Mode.Storehouse, '5', 'Lager'],
  [Mode.Demolish, '6', 'Abreissen'],
];

const BUILD_TYPE: Partial<Record<Mode, BuildingType>> = {
  [Mode.Woodcutter]: BuildingType.Woodcutter,
  [Mode.Sawmill]: BuildingType.Sawmill,
  [Mode.Storehouse]: BuildingType.Storehouse,
};

const PAN_KEY_SPEED = 18; // Tiles pro Sekunde

export class Input {
  mode: Mode = Mode.Pan;
  onModeChange: ((m: Mode) => void) | null = null;

  private queue: Command[] = [];
  private keys = new Set<string>();
  private pointerDown = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;
  private hoverX: number | null = null;
  private hoverY: number | null = null;
  /** Beim Strassenmalen nicht bei jedem Pixel denselben Tile schicken. */
  private lastPainted = '';

  constructor(
    private canvas: HTMLCanvasElement,
    private cam: Camera,
  ) {
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.hoverY = null;
    });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /** Holt die seit dem letzten Tick gesammelten Commands ab. */
  drain(): Command[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }

  hoverTile(): { x: number; y: number } | null {
    return this.hoverX === null || this.hoverY === null
      ? null
      : { x: this.hoverX, y: this.hoverY };
  }

  /** Tastatur-Panning, einmal pro Frame mit der echten Framezeit aufgerufen. */
  updateKeyboardPan(dtSeconds: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (dx === 0 && dy === 0) return;
    // Bei weit herausgezoomter Ansicht proportional schneller scrollen.
    const speed = (PAN_KEY_SPEED * dtSeconds * 12) / this.cam.zoom;
    this.cam.x += dx * speed;
    this.cam.y += dy * speed;
  }

  setMode(m: Mode): void {
    this.mode = m;
    this.onModeChange?.(m);
  }

  // --- Zeiger ----------------------------------------------------------

  private onPointerDown = (e: PointerEvent): void => {
    // Kann fuer bereits freigegebene oder synthetische Zeiger werfen.
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* Pointer-Capture ist optional - ohne sie funktioniert alles weiter. */
    }
    this.pointerDown = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastPainted = '';
    // Rechte Maustaste schiebt immer, linke nur im Ansehen-Modus.
    this.panning = e.button !== 0 || this.mode === Mode.Pan;
    if (!this.panning) this.paintAt(e.clientX, e.clientY);
    if (this.panning) this.canvas.classList.add('dragging');
  };

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.hoverX = Math.floor(this.cam.screenToWorldX(e.clientX - rect.left));
    this.hoverY = Math.floor(this.cam.screenToWorldY(e.clientY - rect.top));

    if (!this.pointerDown) return;

    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;

    if (this.panning) {
      this.cam.x -= dx / this.cam.zoom;
      this.cam.y -= dy / this.cam.zoom;
    } else if (this.mode === Mode.Road || this.mode === Mode.Demolish) {
      // Strassen und Abriss lassen sich ziehen, Gebaeude nicht.
      this.paintAt(e.clientX, e.clientY);
    }

    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = (): void => {
    this.pointerDown = false;
    this.panning = false;
    this.canvas.classList.remove('dragging');
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.cam.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  };

  private paintAt(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(this.cam.screenToWorldX(clientX - rect.left));
    const y = Math.floor(this.cam.screenToWorldY(clientY - rect.top));
    const key = x + ',' + y;
    if (key === this.lastPainted) return;
    this.lastPainted = key;

    if (this.mode === Mode.Road) {
      this.queue.push({ t: 'road', x, y });
      return;
    }
    if (this.mode === Mode.Demolish) {
      this.queue.push({ t: 'demolish', x, y });
      return;
    }
    const bt = BUILD_TYPE[this.mode];
    if (bt !== undefined) this.queue.push({ t: 'build', bt, x, y });
  }

  // --- Tastatur --------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.keys.add(k);
    const idx = Number(k) - 1;
    if (idx >= 0 && idx < MODE_LABELS.length) this.setMode(MODE_LABELS[idx][0]);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };
}
