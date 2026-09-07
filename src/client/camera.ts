/**
 * Kamera. Reiner Client-Zustand - darf Float sein und darf die Simulation
 * unter keinen Umstaenden beeinflussen.
 */
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

  /** Zoomt so, dass der Punkt unter dem Cursor stehen bleibt. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const wx = this.screenToWorldX(sx);
    const wy = this.screenToWorldY(sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.x = wx - (sx - this.viewW / 2) / this.zoom;
    this.y = wy - (sy - this.viewH / 2) / this.zoom;
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
