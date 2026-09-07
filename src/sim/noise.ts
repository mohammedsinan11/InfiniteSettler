/**
 * Value-Noise auf ganzzahligem Gitter, komplett in Fixed-Point.
 *
 * Bewusst kein Perlin/Simplex mit Gradientenvektoren: die brauchen
 * Normalisierung und damit Wurzeln. Value-Noise mit Smoothstep-Interpolation
 * sieht fuer Terrain praktisch genauso gut aus und bleibt reine Integer-Mathematik.
 */

import { type Fixed, FP_BITS, FP_ONE, mul, div, lerp, smoothstep } from './fixed';
import { hash2i } from './hash';

/** Gitterpunktwert in etwa [-FP_ONE, FP_ONE]. */
function corner(seed: number, gx: number, gy: number): Fixed {
  // 17 Bit aus dem Hash ziehen (0..131071) und um FP_ONE nach unten schieben.
  return ((hash2i(seed, gx, gy) >>> 15) - FP_ONE) | 0;
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
