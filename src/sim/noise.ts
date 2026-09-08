/**
 * Value-Noise auf ganzzahligem Gitter, komplett in Fixed-Point.
 *
 * Bewusst kein Perlin/Simplex mit Gradientenvektoren: die brauchen
 * Normalisierung und damit Wurzeln. Value-Noise mit Smoothstep-Interpolation
 * sieht fuer Terrain praktisch genauso gut aus und bleibt reine Integer-Mathematik.
 */

import { type Fixed, FP_BITS, FP_ONE, mul, div, lerp, smoothstep } from './fixed';
import { hash2i } from './hash';

/**
 * Direkt abgebildeter Cache fuer Gitterpunktwerte.
 *
 * Lohnt sich, weil die tieffrequenten Oktaven innerhalb eines Chunks nur
 * ein bis zwei Gitterzellen ueberdecken: dieselben vier Eckwerte werden
 * sonst tausendfach neu berechnet.
 *
 * Der Cache ist reine Memoisierung einer reinen Funktion - gleiche Eingabe
 * liefert dasselbe Ergebnis, unabhaengig davon, was vorher im Cache stand.
 * Er beeinflusst den Determinismus daher nicht. Die gespeicherten Schluessel
 * werden vollstaendig geprueft, eine Indexkollision liefert also nie einen
 * falschen Wert, sondern nur einen Fehltreffer.
 */
const CORNER_BITS = 14;
const CORNER_MASK = (1 << CORNER_BITS) - 1;
const cKeySeed = new Int32Array(1 << CORNER_BITS);
const cKeyX = new Int32Array(1 << CORNER_BITS);
const cKeyY = new Int32Array(1 << CORNER_BITS);
const cValue = new Int32Array(1 << CORNER_BITS);
const cFilled = new Uint8Array(1 << CORNER_BITS);

/** Gitterpunktwert in etwa [-FP_ONE, FP_ONE]. */
function corner(seed: number, gx: number, gy: number): Fixed {
  const slot =
    (Math.imul(seed, 0x9e3779b9) ^
      Math.imul(gx, 0x85ebca6b) ^
      Math.imul(gy, 0xc2b2ae35)) &
    CORNER_MASK;

  if (
    cFilled[slot] === 1 &&
    cKeySeed[slot] === seed &&
    cKeyX[slot] === gx &&
    cKeyY[slot] === gy
  ) {
    return cValue[slot];
  }

  // 17 Bit aus dem Hash ziehen (0..131071) und um FP_ONE nach unten schieben.
  const v = ((hash2i(seed, gx, gy) >>> 15) - FP_ONE) | 0;
  cFilled[slot] = 1;
  cKeySeed[slot] = seed;
  cKeyX[slot] = gx;
  cKeyY[slot] = gy;
  cValue[slot] = v;
  return v;
}

/**
 * Eine Noise-Oktave. cellBits gibt die Gitterweite als Zweierpotenz an:
 * cellBits = 6 bedeutet ein Gitterpunkt alle 64 Tiles.
 */
export function valueNoise2(
  seed: number,
  x: number,
  y: number,
  cellBits: number,
): Fixed {
  const gx = x >> cellBits;
  const gy = y >> cellBits;

  // Bruchteil innerhalb der Zelle, hochskaliert auf [0, FP_ONE).
  const fx = ((x & ((1 << cellBits) - 1)) << (FP_BITS - cellBits)) | 0;
  const fy = ((y & ((1 << cellBits) - 1)) << (FP_BITS - cellBits)) | 0;

  const sx = smoothstep(fx);
  const sy = smoothstep(fy);

  const top = lerp(corner(seed, gx, gy), corner(seed, gx + 1, gy), sx);
  const bot = lerp(corner(seed, gx, gy + 1), corner(seed, gx + 1, gy + 1), sx);
  return lerp(top, bot, sy);
}

/**
 * Fractal Brownian Motion: mehrere Oktaven mit fallender Amplitude und
 * halbierter Gitterweite. Ergebnis wieder in etwa [-FP_ONE, FP_ONE].
 *
 * gain steuert, wie schnell die Amplitude pro Oktave faellt. Der Wert ist
 * wichtiger, als er aussieht: bei 0.5 dominiert die erste Oktave so stark,
 * dass ganze Bildschirme in einer einzigen Basiszelle liegen - dann ist
 * eine Region reiner Ozean und die naechste reines Festland. Hoehere Werte
 * geben den mittleren Frequenzen mehr Gewicht und damit jedem Ausschnitt
 * eine aehnliche Mischung.
 */
export function fbm(
  seed: number,
  x: number,
  y: number,
  octaves: number,
  baseCellBits: number,
  gain: Fixed = FP_ONE >> 1,
): Fixed {
  let sum = 0;
  let amp = FP_ONE;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    const cellBits = baseCellBits - i;
    if (cellBits < 1) break;
    // Pro Oktave ein eigener Seed, sonst korrelieren die Oktaven sichtbar.
    const octaveSeed = (seed + Math.imul(i + 1, 0x9e3779b9)) | 0;
    sum = (sum + mul(valueNoise2(octaveSeed, x, y, cellBits), amp)) | 0;
    norm = (norm + amp) | 0;
    amp = mul(amp, gain);
  }

  return norm === 0 ? 0 : div(sum, norm);
}

/**
 * Ridged Noise: statt weicher Huegel entstehen scharfe Grate.
 *
 * Der Trick ist 1 - |noise|. Wo das gewoehnliche Noise durch null geht,
 * entsteht ein Maximum - also eine Linie statt eines Flecks. Genau das
 * unterscheidet einen Gebirgszug von einem runden grauen Klecks.
 *
 * Ergebnis liegt in [0, FP_ONE], nicht in [-FP_ONE, FP_ONE].
 */
export function ridgedFbm(
  seed: number,
  x: number,
  y: number,
  octaves: number,
  baseCellBits: number,
  gain: Fixed = FP_ONE >> 1,
): Fixed {
  let sum = 0;
  let amp = FP_ONE;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    const cellBits = baseCellBits - i;
    if (cellBits < 1) break;
    const octaveSeed = (seed + Math.imul(i + 1, 0x9e3779b9)) | 0;
    const n = valueNoise2(octaveSeed, x, y, cellBits);
    const ridge = (FP_ONE - (n < 0 ? -n : n)) | 0;
    sum = (sum + mul(ridge, amp)) | 0;
    norm = (norm + amp) | 0;
    amp = mul(amp, gain);
  }

  return norm === 0 ? 0 : div(sum, norm);
}

/**
 * Domain Warping: die Abfrageposition selbst wird durch ein zweites
 * Noise-Feld verschoben, bevor das eigentliche Feld ausgewertet wird.
 *
 * Das ist der groesste optische Hebel bei prozeduralem Terrain. Ohne
 * Warping sind Kuestenlinien im Kern Hoehenlinien einer glatten Funktion
 * und wirken rund und blasig. Mit Warping werden sie gedehnt, gefaltet und
 * eingeschnuert - es entstehen Halbinseln, Fjorde und Buchten.
 *
 * Der Versatz ist ganzzahlig in Tiles, was auf einem Kachelgitter ohnehin
 * die passende Aufloesung ist.
 */
export function warpOffset(
  seed: number,
  x: number,
  y: number,
  cellBits: number,
  amountTiles: number,
): number {
  return (valueNoise2(seed, x, y, cellBits) * amountTiles) >> FP_BITS;
}
