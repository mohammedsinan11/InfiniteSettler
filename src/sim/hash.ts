/**
 * Deterministische Hashfunktionen. Alles auf Math.imul aufgebaut, das als
 * exakte 32-Bit-Multiplikation spezifiziert ist.
 */

/** Ortsabhaengiger Hash fuer prozedurale Generierung. Liefert uint32. */
export function hash2i(seed: number, x: number, y: number): number {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 15;
  return h >>> 0;
}

/** FNV-1a ueber einen String. Fuer Zustands-Hashes im Determinismus-Test. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const hex8 = (n: number): string =>
  (n >>> 0).toString(16).padStart(8, '0');
