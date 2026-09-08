/**
 * Kamera mit weicher Bewegung.
 *
 * Reiner Client-Zustand: darf Float sein und darf die Simulation unter
 * keinen Umstaenden beeinflussen. Deshalb steht hier auch bewusst
 * Math.exp und Math.hypot - in src/sim waeren beide verboten.
 *
 * Drei Mechanismen:
 *   - Tastatur-Panning ueber eine Geschwindigkeit mit Beschleunigung und
 *     Nachlauf, statt die Position direkt zu setzen.
 *   - Zoom laeuft auf einen Zielwert zu, statt zu springen. Der Punkt unter
 *     dem Cursor bleibt waehrend der ganzen Animation stehen.
 *   - Nach dem Ziehen mit der Maus laeuft die Karte kurz aus.
 */

/** Geschwindigkeiten in BILDSCHIRMPIXELN pro Sekunde, nicht in Tiles.
 *  So fuehlt sich das Scrollen bei jedem Zoomgrad gleich an. */
const PAN_MAX_PX = 190;
const PAN_ACCEL_PX = 900;
const PAN_BOOST = 3.2;
/** Nachlauf nach dem Loslassen: e^(-dt*DAMP), 7 entspricht gut 0.4 s Ausrollen. */
const PAN_DAMP = 7;
/** Aus dem Ziehen uebernommener Schwung wird gedeckelt. */
const FLING_MAX_PX = 2600;

const ZOOM_STEP = 1.12;
/** Wie schnell der Zoom seinen Zielwert einholt. 14 entspricht etwa 0.2 s. */
const ZOOM_RATE = 14;

export interface PanAxis {
  x: number;
  y: number;
  boost: boolean;
}

export class Camera {
  /** Weltposition (in Tiles) im Bildschirmmittelpunkt. */
  x = 0;
  y = 0;
  /** Pixel pro Tile. */
  zoom = 12;

  readonly minZoom = 2;
  readonly maxZoom = 48;

  viewW = 1;
  viewH = 1;

  /** Tiles pro Sekunde. */
  private vx = 0;
  private vy = 0;

  private targetZoom = 12;
  private anchorWorldX = 0;
  private anchorWorldY = 0;
  private anchorScreenX = 0;
  private anchorScreenY = 0;
  private hasAnchor = false;

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  worldToScreenX(wx: number): number {
    return (wx - this.x) * this.zoom + this.viewW / 2;
  }

  worldToScreenY(wy: number): number {
    return (wy - this.y) * this.zoom + this.viewH / 2;
  }

  screenToWorldX(sx: number): number {
    return (sx - this.viewW / 2) / this.zoom + this.x;
  }

  screenToWorldY(sy: number): number {
    return (sy - this.viewH / 2) / this.zoom + this.y;
  }

  /** Kamera hart an eine Stelle setzen (Start, Laden). */
  jumpTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.stopMotion();
  }

  /**
   * Zoom hart setzen. Notwendig, weil ein direktes cam.zoom = x von update()
   * sofort wieder auf targetZoom zurueckgezogen wuerde - das Feld allein ist
   * nicht mehr die Wahrheit.
   */
  setZoom(z: number): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, z));
    this.targetZoom = this.zoom;
    this.hasAnchor = false;
  }

  stopMotion(): void {
    this.vx = 0;
    this.vy = 0;
    this.hasAnchor = false;
  }

  /**
   * Mausrad. notches ist die Anzahl Rasten, positiv = heranzoomen.
   * Merkt sich den Weltpunkt unter dem Cursor, damit er waehrend der
   * gesamten Animation an derselben Bildschirmstelle bleibt.
   */
  zoomBy(sx: number, sy: number, notches: number): void {
    const next = this.targetZoom * Math.pow(ZOOM_STEP, notches);
    this.targetZoom = Math.min(this.maxZoom, Math.max(this.minZoom, next));
    this.anchorWorldX = this.screenToWorldX(sx);
    this.anchorWorldY = this.screenToWorldY(sy);
    this.anchorScreenX = sx;
    this.anchorScreenY = sy;
    this.hasAnchor = true;
  }

  /** Waehrend des Ziehens: 1:1 mitbewegen, ohne Traegheit. */
  dragBy(dxPixels: number, dyPixels: number): void {
    this.x -= dxPixels / this.zoom;
    this.y -= dyPixels / this.zoom;
    this.vx = 0;
    this.vy = 0;
    this.hasAnchor = false;
  }

  /** Beim Loslassen: Schwung aus der letzten Zeigerbewegung uebernehmen. */
  fling(pxPerSecondX: number, pxPerSecondY: number): void {
    const sp = Math.hypot(pxPerSecondX, pxPerSecondY);
    if (sp < 40) return; // langsames Loslassen soll nicht nachrutschen
    const scale = sp > FLING_MAX_PX ? FLING_MAX_PX / sp : 1;
    this.vx = (-pxPerSecondX * scale) / this.zoom;
    this.vy = (-pxPerSecondY * scale) / this.zoom;
  }

  /**
   * Einmal pro Frame mit der echten Framezeit aufrufen.
   * Die Glaettung ueber Math.exp ist bildratenunabhaengig: bei 30 und bei
   * 144 FPS ergibt sich derselbe zeitliche Verlauf.
   */
  update(dtSeconds: number, axis: PanAxis): void {
    const dt = Math.min(dtSeconds, 0.1); // nach einem Hänger nicht springen

    // --- Zoom ---
    if (Math.abs(this.targetZoom - this.zoom) > 0.0005) {
      this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-dt * ZOOM_RATE));
      if (this.hasAnchor) {
        this.x = this.anchorWorldX - (this.anchorScreenX - this.viewW / 2) / this.zoom;
        this.y = this.anchorWorldY - (this.anchorScreenY - this.viewH / 2) / this.zoom;
      }
    } else if (this.zoom !== this.targetZoom) {
      this.zoom = this.targetZoom;
      this.hasAnchor = false;
    }

    // --- Panning ---
    const active = axis.x !== 0 || axis.y !== 0;
    const maxSpeed = (PAN_MAX_PX * (axis.boost ? PAN_BOOST : 1)) / this.zoom;

    if (active) {
      // Diagonale nicht schneller machen als gerade Richtungen.
      const len = Math.hypot(axis.x, axis.y);
      const accel = (PAN_ACCEL_PX * (axis.boost ? PAN_BOOST : 1)) / this.zoom;
      this.vx += (axis.x / len) * accel * dt;
      this.vy += (axis.y / len) * accel * dt;
      this.hasAnchor = false; // Panning bricht den Zoom-Anker
    } else {
      // Ausrollen statt abruptem Stopp.
      const damp = Math.exp(-dt * PAN_DAMP);
      this.vx *= damp;
      this.vy *= damp;
    }

    const speed = Math.hypot(this.vx, this.vy);
    if (active && speed > maxSpeed) {
      this.vx = (this.vx / speed) * maxSpeed;
      this.vy = (this.vy / speed) * maxSpeed;
    }
    if (speed < 0.02) {
      this.vx = 0;
      this.vy = 0;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /** Sichtbarer Tile-Bereich, eine Kachel Rand zur Sicherheit. */
  visibleTiles(): { x0: number; y0: number; x1: number; y1: number } {
    return {
      x0: Math.floor(this.screenToWorldX(0)) - 1,
      y0: Math.floor(this.screenToWorldY(0)) - 1,
      x1: Math.ceil(this.screenToWorldX(this.viewW)) + 1,
      y1: Math.ceil(this.screenToWorldY(this.viewH)) + 1,
    };
  }
}
