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
export type GoodSprite = keyof typeof manifest.goods;
export type ScatterSprite = keyof typeof manifest.scatter;
export type ShoreSprite = keyof typeof manifest.shore;
export type ShipDirection = keyof typeof manifest.ship;
export type HarborDirection = keyof typeof manifest.smallHarbor;
export type CarrierDirection = keyof typeof manifest.carrier;
export type TreeBiome = keyof typeof manifest.trees;

export interface GameAssets {
  terrain: Record<TerrainSprite, HTMLImageElement[]>;
  buildings: Record<number, HTMLImageElement[]>;
  trees: Record<TreeBiome, HTMLImageElement[]>;
  resources: Record<ResourceSprite, HTMLImageElement[]>;
  /** Warensymbole fuer die Anzeige - nicht jede Ware hat eines. */
  goods: Record<GoodSprite, HTMLImageElement[]>;
  /** Streuwerk: Blumen, Buesche, junge Baeume. */
  scatter: Record<ScatterSprite, HTMLImageElement[]>;
  /** Uferkanten - Felswand unter einer Grasoberkante. */
  shore: Record<ShoreSprite, HTMLImageElement[]>;
  carrier: Record<CarrierDirection, HTMLImageElement | null>;
  /** Handelsschiff in vier Blickrichtungen. */
  ship: Record<ShipDirection, HTMLImageElement | null>;
  /**
   * Kleiner Hafen in vier Blickrichtungen.
   *
   * Der einzige Bau mit echten Ansichten statt Gestaltungsvarianten - und
   * damit der einzige, dessen Steg auch nach Norden zeigen kann.
   */
  smallHarbor: Record<HarborDirection, HTMLImageElement | null>;
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
  const [terrainEntries, buildingEntries, treeEntries, resourceEntries, goodEntries, scatterEntries, shoreEntries, carrierEntries, shipEntries, smallHarborEntries] =
    await Promise.all([
      Promise.all(
        Object.entries(manifest.terrain).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      Promise.all(
        Object.entries(manifest.buildings).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      Promise.all(
        Object.entries(manifest.trees).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      Promise.all(
        Object.entries(manifest.resources).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      Promise.all(
        Object.entries(manifest.goods).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      Promise.all(
        Object.entries(manifest.scatter).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      Promise.all(
        Object.entries(manifest.shore).map(async ([name, paths]) =>
          [name, await loadGroup(paths)] as const),
      ),
      Promise.all(
        Object.entries(manifest.carrier).map(async ([name, path]) =>
          [name, await loadImage(path)] as const),
      ),
      Promise.all(
        Object.entries(manifest.ship).map(async ([name, path]) =>
          [name, await loadImage(path)] as const),
      ),
      Promise.all(
        Object.entries(manifest.smallHarbor).map(async ([name, path]) =>
          [name, await loadImage(path)] as const),
      ),
    ]);

  const terrain = Object.fromEntries(terrainEntries) as GameAssets['terrain'];
  const namedBuildings = Object.fromEntries(buildingEntries);
  const buildings: GameAssets['buildings'] = {
    [BuildingType.Woodcutter]: namedBuildings.woodcutter ?? [],
    [BuildingType.Sawmill]: namedBuildings.sawmill ?? [],
    [BuildingType.Storehouse]: namedBuildings.storehouse ?? [],
    [BuildingType.Harbor]: namedBuildings.harbor ?? [],
    [BuildingType.Quarry]: namedBuildings.quarry ?? [],
    [BuildingType.Depot]: namedBuildings.depot ?? [],
    [BuildingType.SmallHarbor]: namedBuildings.small_harbor ?? [],
    [BuildingType.House]: namedBuildings.house ?? [],
    [BuildingType.FisherHut]: namedBuildings.fisher_hut ?? [],
    [BuildingType.Farm]: namedBuildings.farm ?? [],
    [BuildingType.Mill]: namedBuildings.mill ?? [],
    [BuildingType.Bakery]: namedBuildings.bakery ?? [],
  };
  const resources = Object.fromEntries(resourceEntries) as GameAssets['resources'];
  const trees = Object.fromEntries(treeEntries) as GameAssets['trees'];
  const goods = Object.fromEntries(goodEntries) as GameAssets['goods'];
  const scatter = Object.fromEntries(scatterEntries) as GameAssets['scatter'];
  const shore = Object.fromEntries(shoreEntries) as GameAssets['shore'];
  const carrier = Object.fromEntries(carrierEntries) as GameAssets['carrier'];
  const ship = Object.fromEntries(shipEntries) as GameAssets['ship'];
  const smallHarbor = Object.fromEntries(smallHarborEntries) as GameAssets['smallHarbor'];

  const all = [
    ...Object.values(terrain).flat(),
    ...Object.values(buildings).flat(),
    ...Object.values(trees).flat(),
    ...Object.values(resources).flat(),
    ...Object.values(goods).flat(),
    ...Object.values(scatter).flat(),
    ...Object.values(shore).flat(),
    ...Object.values(carrier),
    ...Object.values(ship),
    ...Object.values(smallHarbor),
  ];
  const loaded = all.filter((image) => image !== null).length;
  const expected =
    Object.values(manifest.terrain).reduce((n, paths) => n + paths.length, 0) +
    Object.values(manifest.buildings).reduce((n, paths) => n + paths.length, 0) +
    Object.values(manifest.trees).reduce((n, paths) => n + paths.length, 0) +
    Object.values(manifest.resources).reduce((n, paths) => n + paths.length, 0) +
    Object.values(manifest.goods).reduce((n, paths) => n + paths.length, 0) +
    Object.values(manifest.scatter).reduce((n, paths) => n + paths.length, 0) +
    Object.values(manifest.shore).reduce((n, paths) => n + paths.length, 0) +
    Object.keys(manifest.carrier).length +
    Object.keys(manifest.ship).length +
    Object.keys(manifest.smallHarbor).length;

  return {
    terrain,
    buildings,
    trees,
    resources,
    goods,
    scatter,
    shore,
    carrier,
    ship,
    smallHarbor,
    loaded,
    missing: expected - loaded,
  };
}

export function emptyGameAssets(): GameAssets {
  return {
    terrain: {
      grass: [], dirt: [], sand: [], road: [], water: [],
      forest_ground: [], rock: [],
    },
    buildings: {
      [BuildingType.Woodcutter]: [],
      [BuildingType.Sawmill]: [],
      [BuildingType.Storehouse]: [],
      [BuildingType.Harbor]: [],
      [BuildingType.Quarry]: [],
      [BuildingType.Depot]: [],
      [BuildingType.SmallHarbor]: [],
      [BuildingType.House]: [],
      [BuildingType.FisherHut]: [],
      [BuildingType.Farm]: [],
      [BuildingType.Mill]: [],
      [BuildingType.Bakery]: [],
    },
    trees: { temperate: [], conifer: [], snow: [] },
    resources: { stone: [], mountain: [] },
    goods: { wood: [], plank: [], stone: [], fish: [], grain: [], flour: [], bread: [] },
    scatter: { flowers: [], bushes: [], saplings: [] },
    shore: { cliff: [] },
    carrier: { down: null, left: null, right: null, up: null },
    ship: { down: null, left: null, right: null, up: null },
    smallHarbor: { down: null, left: null, right: null, up: null },
    loaded: 0,
    missing: 0,
  };
}
