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
  Quarry: 'quarry',
  Storehouse: 'storehouse',
  Harbor: 'harbor',
  Demolish: 'demolish',
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

/**
 * Gruppen der Werkzeugleiste. Vorher standen alle Knoepfe in einer Reihe;
 * mit sieben Gebaeuden wird daraus eine unlesbare Kette. Die Gruppierung
 * trennt "womit sehe und zeichne ich" von "was baue ich".
 */
export const ModeGroup = {
  Tool: 'werkzeug',
  Building: 'gebaeude',
  Remove: 'abriss',
} as const;
export type ModeGroup = (typeof ModeGroup)[keyof typeof ModeGroup];

export interface ModeEntry {
  readonly mode: Mode;
  readonly key: string;
  readonly label: string;
  readonly group: ModeGroup;
}

export const MODES: readonly ModeEntry[] = [
  { mode: Mode.Pan, key: '1', label: 'Ansehen', group: ModeGroup.Tool },
  { mode: Mode.Road, key: '2', label: 'Strasse', group: ModeGroup.Tool },
  { mode: Mode.Woodcutter, key: '3', label: 'Holzfaeller', group: ModeGroup.Building },
  { mode: Mode.Sawmill, key: '4', label: 'Saegewerk', group: ModeGroup.Building },
  { mode: Mode.Quarry, key: '5', label: 'Steinbruch', group: ModeGroup.Building },
  { mode: Mode.Storehouse, key: '6', label: 'Lager', group: ModeGroup.Building },
  { mode: Mode.Harbor, key: '7', label: 'Hafen', group: ModeGroup.Building },
  { mode: Mode.Demolish, key: '8', label: 'Abreissen', group: ModeGroup.Remove },
];

export const BUILD_TYPE: Partial<Record<Mode, BuildingType>> = {
  [Mode.Woodcutter]: BuildingType.Woodcutter,
  [Mode.Sawmill]: BuildingType.Sawmill,
  [Mode.Quarry]: BuildingType.Quarry,
  [Mode.Storehouse]: BuildingType.Storehouse,
  [Mode.Harbor]: BuildingType.Harbor,
};

export class Input {
  mode: Mode = Mode.Pan;
  onModeChange: ((m: Mode) => void) | null = null;
  /**
   * Verlegt eine Bauposition, bevor der Command entsteht.
   *
   * Muss dieselbe Verlegung liefern wie die Bauvorschau - sonst zeigte die
   * Vorschau die eingerastete Stelle, gebaut wuerde aber unter dem Zeiger.
   */
  resolveBuild: ((x: number, y: number) => { x: number; y: number }) | null = null;

  private queue: Command[] = [];
  private keys = new Set<string>();
  private pointerDown = false;
  private panning = false;
  /**
   * Alle aktiven Zeiger. Auf dem Handy gibt es keine rechte Maustaste und
   * keine Tastatur - zwei Finger sind dort die einzige Moeglichkeit, im
   * Baumodus zu schieben und zu zoomen, ohne versehentlich zu bauen.
   */
  private pointers = new Map<number, { x: number; y: number }>();
  private gestureDist = 0;
  private gestureMidX = 0;
  private gestureMidY = 0;
  /** Laenge der Warteschlange vor dem letzten Zeigerdruck. */
  private queueBeforePress = 0;
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
    window.addEventListener('pointercancel', this.onPointerUp);
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

    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // Zweiter Finger: aus dem Malen wird eine Schieb-/Zoomgeste.
      //
      // Der erste Finger hat im Baumodus aber schon einen Bau in die
      // Warteschlange gelegt. Auf dem Handy ist die Zwei-Finger-Geste die
      // einzige Art zu schieben, also darf sie nicht jedes Mal ein
      // ungewolltes Gebaeude hinterlassen - der Eintrag wird zurueckgenommen.
      this.queue.length = this.queueBeforePress;
      this.pointerDown = false;
      this.panning = false;
      this.lastPainted = '';
      this.beginGesture();
      this.cam.stopMotion();
      return;
    }
    if (this.pointers.size > 2) return;

    this.queueBeforePress = this.queue.length;
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
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.pointers.size >= 2) {
      this.handleGesture();
      return;
    }

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

  private beginGesture(): void {
    const [a, b] = [...this.pointers.values()];
    const rect = this.canvas.getBoundingClientRect();
    this.gestureDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.gestureMidX = (a.x + b.x) / 2 - rect.left;
    this.gestureMidY = (a.y + b.y) / 2 - rect.top;
  }

  /** Zwei Finger: Mittelpunkt schiebt, Abstand zoomt. */
  private handleGesture(): void {
    const [a, b] = [...this.pointers.values()];
    const rect = this.canvas.getBoundingClientRect();
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2 - rect.left;
    const midY = (a.y + b.y) / 2 - rect.top;

    if (this.gestureDist <= 0) {
      this.gestureDist = dist;
      this.gestureMidX = midX;
      this.gestureMidY = midY;
      return;
    }

    // Erst schieben (Mittelpunkt), dann zoomen (Abstand) - beides in
    // derselben Geste, wie man es von Karten-Apps kennt.
    this.cam.dragBy(midX - this.gestureMidX, midY - this.gestureMidY);
    const ratio = dist / this.gestureDist;
    // Winzige Schwankungen ignorieren, sonst zittert das Bild beim Halten.
    if (Math.abs(ratio - 1) > 0.01) this.cam.pinch(midX, midY, ratio);

    this.gestureDist = dist;
    this.gestureMidX = midX;
    this.gestureMidY = midY;
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size >= 2) {
      this.beginGesture();
      return;
    }
    if (this.pointers.size === 1) {
      // Ein Finger bleibt liegen: keine Restbewegung ausloesen.
      this.gestureDist = 0;
      this.pointerDown = false;
      this.panning = false;
      return;
    }
    this.gestureDist = 0;
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

    // Zwischen dem zuletzt bemalten und diesem Feld auffuellen.
    //
    // pointermove feuert nicht fuer jedes ueberstrichene Feld: bei zuegigem
    // Ziehen springt der Zeiger mehrere Kacheln weiter und die Strasse
    // bekam Luecken. Wie stark, hing von Ziehrichtung und Tempo ab - genau
    // deshalb wirkte manche Richtung "unsauber".
    if (this.lastPainted !== '') {
      const [px, py] = this.lastPainted.split(',').map(Number);
      const steps = Math.max(Math.abs(x - px), Math.abs(y - py));
      for (let i = 1; i < steps; i++) {
        this.emitPaint(
          px + Math.round(((x - px) * i) / steps),
          py + Math.round(((y - py) * i) / steps),
        );
      }
    }

    this.lastPainted = key;
    this.emitPaint(x, y);
  }

  private emitPaint(x: number, y: number): void {
    if (this.mode === Mode.Road) {
      this.queue.push({ t: 'road', x, y });
      return;
    }
    if (this.mode === Mode.Demolish) {
      this.queue.push({ t: 'demolish', x, y });
      return;
    }
    const bt = BUILD_TYPE[this.mode];
    if (bt === undefined) return;
    const at = this.resolveBuild?.(x, y) ?? { x, y };
    this.queue.push({ t: 'build', bt, x: at.x, y: at.y });
  }

  // --- Tastatur --------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.keys.add(k);
    const entry = MODES.find((m) => m.key === k);
    if (entry) this.setMode(entry.mode);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };
}
