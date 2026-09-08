import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../src/assets/medieval/manifest.json';

/**
 * Gruppen einzeln, weil Dateien bewusst mehrfach vorkommen duerfen:
 * stone_01 dient sowohl als Geroell auf der Karte als auch als
 * Warensymbol fuer Stein. Doppelte innerhalb EINER Gruppe waeren dagegen
 * ein Fehler - dann zeigte eine Variante zweimal dasselbe Bild.
 */
const groups: Array<[string, string[]]> = [
  ['terrain', Object.values(manifest.terrain).flat()],
  ['goods', Object.values(manifest.goods).flat()],
  ['scatter', Object.values(manifest.scatter).flat()],
  ['buildings', Object.values(manifest.buildings).flat()],
  ['trees', [...manifest.trees]],
  ['resources', Object.values(manifest.resources).flat()],
  ['carrier', Object.values(manifest.carrier)],
];
const paths = [...new Set(groups.flatMap(([, p]) => p))];

describe('Grafikmanifest', () => {
  it('enthaelt nur eindeutige, vorhandene PNG-Dateien', () => {
    for (const [name, list] of groups) {
      expect(new Set(list).size, `${name} enthaelt Doppelte`).toBe(list.length);
    }
    expect(paths.length).toBe(106);

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
      'harbor',
      'quarry',
      'sawmill',
      'storehouse',
      'woodcutter',
    ]);
  });
});
