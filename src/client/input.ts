/**
 * Eingabe. Erzeugt ausschliesslich Commands - nie direkte Zustandsaenderungen.
 *
 * Genau diese Warteschlange wird in M5 zur Netzwerkschnittstelle: statt die
 * Commands sofort auszufuehren, gehen sie dann mit ein paar Ticks Verzoegerung
 * ueber die Leitung und werden bei allen Clients gleichzeitig angewendet.
 */

import type { Command } from '../sim/commands';
import { BuildingType } from '../sim/types';
import type { Camera, PanAxis } from './camera';

export const Mode = {
  Pan: 'pan',
  Road: 'road',
  Woodcutter: 'woodcutter',
  Sawmill: 'sawmill',
  Storehouse: 'storehouse',
  Harbor: 'harbor',
  Demolish: 'demolish',
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export const MODE_LABELS: Array<[Mode, string, string]> = [
  [Mode.Pan, '1', 'Ansehen'],
  [Mode.Road, '2', 'Strasse'],
  [Mode.Woodcutter, '3', 'Holzfaeller'],
  [Mode.Sawmill, '4', 'Saegewerk'],
  [Mode.Storehouse, '5', 'Lager'],
  [Mode.Harbor, '6', 'Hafen'],
  [Mode.Demolish, '7', 'Abreissen'],
];

const BUILD_TYPE: Partial<Record<Mode, BuildingType>> = {
  [Mode.Woodcutter]: BuildingType.Woodcutter,
  [Mode.Sawmill]: BuildingType.Sawmill,
  [Mode.Storehouse]: BuildingType.Storehouse,
  [Mode.Harbor]: BuildingType.Harbor,
};

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
  /** Letzte Zeigerbewegung, fuer den Schwung beim Loslassen. */
  private flingX = 0;
  private flingY = 0;
  private lastMoveAt = 0;
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

  /**
   * Gewuenschte Scrollrichtung aus der Tastatur. Die Kamera macht daraus
   * eine Geschwindigkeit mit Beschleunigung und Nachlauf - hier wird
   * bewusst nichts direkt bewegt.
   */
  panAxis(): PanAxis {
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    // Beim Ziehen soll die Tastatur nicht dazwischenfunken.
    if (this.panning) return { x: 0, y: 0, boost: false };
    return { x, y, boost: this.keys.has('shift') };
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
    this.flingX = 0;
    this.flingY = 0;
    this.lastMoveAt = e.timeStamp;
    this.cam.stopMotion();
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
      this.cam.dragBy(dx, dy);
      // Gleitender Mittelwert der Zeigergeschwindigkeit in Pixel/Sekunde.
      const dtMs = Math.max(1, e.timeStamp - this.lastMoveAt);
      this.flingX = this.flingX * 0.6 + ((dx / dtMs) * 1000) * 0.4;
      this.flingY = this.flingY * 0.6 + ((dy / dtMs) * 1000) * 0.4;
      this.lastMoveAt = e.timeStamp;
    } else if (this.mode === Mode.Road || this.mode === Mode.Demolish) {
      // Strassen und Abriss lassen sich ziehen, Gebaeude nicht.
      this.paintAt(e.clientX, e.clientY);
    }

    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    // Nur nachrutschen lassen, wenn der Zeiger zuletzt wirklich in Bewegung war.
    if (this.panning && e.timeStamp - this.lastMoveAt < 80) {
      this.cam.fling(this.flingX, this.flingY);
    }
    this.pointerDown = false;
    this.panning = false;
    this.flingX = 0;
    this.flingY = 0;
    this.canvas.classList.remove('dragging');
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    // deltaMode 1 = Zeilen (Firefox), sonst Pixel. Auf Rasten normieren.
    const raw = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const notches = Math.max(-3, Math.min(3, -raw / 100));
    this.cam.zoomBy(e.clientX - rect.left, e.clientY - rect.top, notches);
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
