import { describe, expect, it } from 'vitest';
import { Tile } from '../src/sim/terrain';
import {
  shouldOverlayNeighbor,
  smoothedVegetationTile,
  terrainMacroTint,
} from '../src/client/terrain-style';

describe('Terrain-Stil', () => {
  it('mischt jede Materialgrenze nur in eine Richtung', () => {
    const pairs = [
      ['water', 'sand'],
      ['forest_ground', 'sand'],
      ['forest_ground', 'grass'],
      ['grass', 'rock'],
      ['grass', 'dirt'],
    ] as const;
    for (const [a, b] of pairs) {
      expect(shouldOverlayNeighbor(a, b), `${b} soll in ${a} greifen`).toBe(true);
      expect(shouldOverlayNeighbor(b, a), `${a} darf nicht in ${b} greifen`).toBe(false);
    }
  });

  it('liefert deterministische, grossraeumig wechselnde Farbstimmungen', () => {
    const seed = 123456;
    expect(terrainMacroTint(seed, 80, -40, Tile.Grass))
      .toEqual(terrainMacroTint(seed, 80, -40, Tile.Grass));

    const samples = new Set<string>();
    for (let y = -160; y <= 160; y += 40) {
      for (let x = -160; x <= 160; x += 40) {
        samples.add(terrainMacroTint(seed, x, y, Tile.Grass).join(','));
      }
    }
    expect(samples.size).toBeGreaterThan(8);
  });

  it('entfernt nur kleine Vegetationsinseln aus der Darstellungsmaske', () => {
    expect(smoothedVegetationTile(Tile.Forest, 2, 25)).toBe(Tile.Grass);
    expect(smoothedVegetationTile(Tile.Grass, 22, 25)).toBe(Tile.Forest);
    expect(smoothedVegetationTile(Tile.Forest, 13, 25)).toBe(Tile.Forest);
    expect(smoothedVegetationTile(Tile.Grass, 13, 25)).toBe(Tile.Grass);
    expect(smoothedVegetationTile(Tile.Sand, 25, 25)).toBe(Tile.Sand);
  });
});
