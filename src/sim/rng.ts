/**
 * Geseedeter PRNG (mulberry32). Der Zustand ist ein einzelner int32 und
 * damit trivial serialisierbar - wichtig, weil der RNG-Zustand Teil des
 * Weltzustands ist und beim Speichern und beim Netzwerk-Join mitmuss.
 *
 * Math.random ist in der Simulation verboten: nicht seedbar, nicht reproduzierbar.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed | 0;
  }

  /** Naechster uint32. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Ganzzahl in [0, n). */
  int(n: number): number {
    if (n <= 0) return 0;
    return this.next() % n;
  }

  getState(): number {
    return this.s;
  }

  setState(s: number): void {
    this.s = s | 0;
  }
}
