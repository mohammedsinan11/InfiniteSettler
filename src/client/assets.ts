/**
 * Zentrale, fehlertolerante Grafikladung.
 *
 * Die Manifestdatei beschreibt nur die kuratierte Teilmenge des Roh-Atlas.
 * import.meta.glob sorgt dafuer, dass Vite die PNGs mit Hash in den Build
 * uebernimmt und der GitHub-Pages-Basispfad automatisch stimmt.
 */

import manifest from '../assets/medieval/manifest.json';
import { BuildingType } from '../sim/types';

export type TerrainSprite = keyof typeof manifest.terrain;
export type ResourceSprite = keyof typeof manifest.resources;
export type CarrierDirection = keyof typeof manifest.carrier;

export interface GameAssets {
  terrain: Record<TerrainSprite, HTMLImageElement[]>;
  buildings: Record<number, HTMLImageElement[]>;
  trees: HTMLImageElement[];
  resources: Record<ResourceSprite, HTMLImageElement[]>;
  carrier: Record<CarrierDirection, HTMLImageElement | null>;
  loaded: number;
  missing: number;
}

const urls = import.meta.glob('../assets/medieval/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const urlFor = (path: string): string | undefined =>
  urls[`../assets/medieval/${path}`];

async function loadImage(path: string): Promise<HTMLImageElement | null> {
  const url = urlFor(path);
  if (!url) {
    console.warn('Grafik fehlt im Build:', path);
    return null;
  }

  const image = new Image();
  image.decoding = 'async';
  return new Promise((resolve) => {
    image.onload = () => resolve(image);
    image.onerror = () => {
      console.warn('Grafik konnte nicht geladen werden:', path);
      resolve(null);
    };
    image.src = url;
  });
}

async function loadGroup(paths: readonly string[]): Promise<HTMLImageElement[]> {
  const images = await Promise.all(paths.map(loadImage));
  return images.filter((image): image is HTMLImageElement => image !== null);
}

export async function loadGameAssets(): Promise<GameAssets> {
  const [terrainEntries, buildingEntries, treeImages, resourceEntries, carrierEntries] =
    await Promise.all([
      Promise.all(
        Object.entries(manifest.terrain).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      Promise.all(
        Object.entries(manifest.buildings).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      loadGroup(manifest.trees),
      Promise.all(
        Object.entries(manifest.resources).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      Promise.all(
        Object.entries(manifest.carrier).map(async ([name, path]) =>
          [name, await loadImage(path)] as const),
      ),
    ]);

  const terrain = Object.fromEntries(terrainEntries) as GameAssets['terrain'];
  const namedBuildings = Object.fromEntries(buildingEntries);
  const buildings: GameAssets['buildings'] = {
    [BuildingType.Woodcutter]: namedBuildings.woodcutter ?? [],
    [BuildingType.Sawmill]: namedBuildings.sawmill ?? [],
    [BuildingType.Storehouse]: namedBuildings.storehouse ?? [],
  };
  const resources = Object.fromEntries(resourceEntries) as GameAssets['resources'];
  const carrier = Object.fromEntries(carrierEntries) as GameAssets['carrier'];

  const all = [
    ...Object.values(terrain).flat(),
    ...Object.values(buildings).flat(),
    ...treeImages,
    ...Object.values(resources).flat(),
    ...Object.values(carrier),
  ];
  const loaded = all.filter((image) => image !== null).length;
  const expected =
    Object.values(manifest.terrain).reduce((n, paths) => n + paths.length, 0) +
    Object.values(manifest.buildings).reduce((n, paths) => n + paths.length, 0) +
    manifest.trees.length +
    Object.values(manifest.resources).reduce((n, paths) => n + paths.length, 0) +
    Object.keys(manifest.carrier).length;

  return {
    terrain,
    buildings,
    trees: treeImages,
    resources,
    carrier,
    loaded,
    missing: expected - loaded,
  };
}

export function emptyGameAssets(): GameAssets {
  return {
    terrain: {
      grass: [], dirt: [], sand: [], road: [], water: [],
      forest_ground: [], snow: [],
    },
    buildings: {
      [BuildingType.Woodcutter]: [],
      [BuildingType.Sawmill]: [],
      [BuildingType.Storehouse]: [],
    },
    trees: [],
    resources: { stone: [], mountain: [] },
    carrier: { down: null, left: null, right: null, up: null },
    loaded: 0,
    missing: 0,
  };
}
