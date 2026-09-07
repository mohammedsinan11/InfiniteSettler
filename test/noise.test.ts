import { describe, expect, it } from 'vitest';
import { FP_ONE } from '../src/sim/fixed';
import { fbm, valueNoise2 } from '../src/sim/noise';
import { ChunkStore, terrainAt } from '../src/sim/chunks';
import { Tile, generateTile } from '../src/sim/terrain';

describe('noise und terrain', () => {
  it('bleibt im erwarteten Wertebereich', () => {
    for (let i = -500; i < 500; i += 7) {
      const v = fbm(1234, i, i * 3, 6, 9);
      expect(v).toBeGreaterThanOrEqual(-FP_ONE);
      expect(v).toBeLessThanOrEqual(FP_ONE);
    }
  });

  it('ist an Zellgrenzen stetig', () => {
    // Direkt links und rechts einer Gitterlinie duerfen keine Spruenge sein.
    const a = valueNoise2(7, 63, 10, 6);
    const b = valueNoise2(7, 64, 10, 6);
    expect(Math.abs(a - b)).toBeLessThan(FP_ONE / 4);
  });

  it('liefert bei gleichem Seed dieselbe Karte', () => {
    for (const [x, y] of [[0, 0], [-1, -1], [12345, -6789], [-100000, 250000]]) {
      expect(generateTile(42, x, y)).toBe(generateTile(42, x, y));
    }
  });

  it('unterscheidet sich bei anderem Seed', () => {
    let diff = 0;
    for (let i = 0; i < 400; i++) {
      if (generateTile(1, i, 0) !== generateTile(2, i, 0)) diff++;
    }
    expect(diff).toBeGreaterThan(50);
  });

  it('funktioniert links und oberhalb des Ursprungs', () => {
    const store = new ChunkStore(99);
    for (const [x, y] of [[-1, -1], [-64, -64], [-65, -65], [-1000, 1000]]) {
      expect(terrainAt(store, x, y)).toBe(generateTile(99, x, y));
    }
  });

  it('erzeugt eine plausible Mischung aus Terrainarten', () => {
    const seen = new Set<Tile>();
    for (let y = -120; y < 120; y += 3) {
      for (let x = -120; x < 120; x += 3) seen.add(generateTile(2024, x, y));
    }
    // Wasser, Gras und Wald sollten in einem 240x240-Ausschnitt vorkommen.
    expect(seen.has(Tile.Water)).toBe(true);
    expect(seen.has(Tile.Grass)).toBe(true);
    expect(seen.has(Tile.Forest)).toBe(true);
  });

  it('cached Chunks statt sie neu zu generieren', () => {
    const store = new ChunkStore(5);
    store.get(0, 0);
    const after = store.generatedCount;
    store.get(0, 0);
    store.get(0, 0);
    expect(store.generatedCount).toBe(after);
  });
});
