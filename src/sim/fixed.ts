/**
 * Fixed-Point-Arithmetik im 16.16-Format.
 *
 * Jede Zahl ist ein int32: die oberen 16 Bit sind der Ganzzahlanteil,
 * die unteren 16 Bit der Bruchteil. FP_ONE (65536) entspricht 1.0.
 *
 * Warum kein Float: Lockstep verlangt, dass alle Clients bitgenau dasselbe
 * rechnen. Integer-Operationen (|0, Math.imul, Shifts) sind in ECMAScript
 * exakt spezifiziert. Math.sin/cos/pow/exp sind es ausdruecklich nicht und
 * unterscheiden sich real zwischen Engines.
 *
 * Alle Funktionen hier sind auf jeder JS-Engine bitidentisch.
 */

export type Fixed = number;

export const FP_BITS = 16;
export const FP_ONE = 1 << FP_BITS; // 65536
export const FP_HALF = FP_ONE >> 1;

export const fromInt = (n: number): Fixed => (n << FP_BITS) | 0;

/** Rundet Richtung -unendlich (wie mul/div hier auch). */
export const toInt = (f: Fixed): number => f >> FP_BITS;

/** Nur fuer Konstanten im Quelltext und fuer Testdaten - nie im Tick-Pfad. */
export const fromFloat = (n: number): Fixed => Math.round(n * FP_ONE) | 0;

/** Nur fuer Anzeige und Rendering - nie zurueck in die Simulation. */
export const toFloat = (f: Fixed): number => f / FP_ONE;

/**
 * Multiplikation. Die Operanden werden in 16-Bit-Haelften zerlegt, weil
 * a*b bei zwei int32-Werten bis zu 2^62 gross wird und damit die exakte
 * Ganzzahlreichweite von double (2^53) sprengen wuerde.
 * Ergebnis ist Richtung -unendlich abgeschnitten.
 */
export function mul(a: Fixed, b: Fixed): Fixed {
  const ah = a >> 16;
  const al = a & 0xffff;
  const bh = b >> 16;
  const bl = b & 0xffff;
  return (
    ((Math.imul(ah, bh) << 16) +
      Math.imul(ah, bl) +
      Math.imul(al, bh) +
      ((al * bl) >>> 16)) |
    0
  );
}

/**
 * Division. a * FP_ONE bleibt mit maximal 2^47 sicher unter 2^53,
 * deshalb reicht hier eine normale Division. Schneidet Richtung 0 ab.
 */
export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0) return 0;
  return ((a * FP_ONE) / b) | 0;
}

/** Ganzzahlige Quadratwurzel. Bewusst nicht Math.sqrt. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  if (n < 4) return 1;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + n / x) / 2);
  }
  // Newton laeuft ueber eine Float-Division und kann um 1 danebenliegen.
  // Diese Korrektur macht das Ergebnis unabhaengig davon exakt.
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

export function sqrt(a: Fixed): Fixed {
  if (a <= 0) return 0;
  return isqrt(a * FP_ONE) | 0;
}

export const abs = (a: Fixed): Fixed => (a < 0 ? -a | 0 : a);

export const lerp = (a: Fixed, b: Fixed, t: Fixed): Fixed =>
  (a + mul((b - a) | 0, t)) | 0;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Smoothstep 3t^2 - 2t^3, erwartet t in [0, FP_ONE]. */
export function smoothstep(t: Fixed): Fixed {
  const t2 = mul(t, t);
  return mul(t2, (3 * FP_ONE - 2 * t) | 0);
}

/** Quadrierter Abstand in Tiles - vermeidet sqrt in Reichweitenpruefungen. */
export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};
