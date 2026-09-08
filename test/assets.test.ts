import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../src/assets/medieval/manifest.json';

const paths = [
  ...Object.values(manifest.terrain).flat(),
  ...Object.values(manifest.buildings).flat(),
  ...manifest.trees,
  ...Object.values(manifest.resources).flat(),
  ...Object.values(manifest.carrier),
];

describe('Grafikmanifest', () => {
  it('enthaelt nur eindeutige, vorhandene PNG-Dateien', () => {
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.length).toBe(82);

    for (const path of paths) {
      const file = new URL(`../src/assets/medieval/${path}`, import.meta.url);
      const png = readFileSync(file);
      expect(png.subarray(0, 8).toString('hex'), path).toBe('89504e470d0a1a0a');
      expect(png.readUInt32BE(16), path).toBeGreaterThan(0);
      expect(png.readUInt32BE(20), path).toBeGreaterThan(0);
    }
  });

  it('deckt alle aktuell simulierbaren Gebaeudetypen ab', () => {
    expect(Object.keys(manifest.buildings).sort()).toEqual([
      'sawmill',
      'storehouse',
      'woodcutter',
    ]);
  });
});
