/**
 * Prozedurale Terraingenerierung. Reine Funktion von (seed, x, y) -
 * daher ist die Karte unendlich gross, ohne dass irgendetwas gespeichert wird.
 *
 * Aufbau in vier Schichten:
 *
 *   1. Domain Warping verschiebt die Abfrageposition. Ohne diesen Schritt
 *      sind Kuesten Hoehenlinien einer glatten Funktion und wirken rund
 *      und blasig; mit ihm entstehen Halbinseln, Buchten und Fjorde.
 *   2. Ein KONTINENTFELD mit sehr grosser Zelle bestimmt die grobe
 *      Land/Meer-Verteilung - dafuer gibt es grosse Seen und Meere.
 *   3. Ein DETAILFELD mit kleiner Zelle bricht das wieder auf. Es ist
 *      bewusst stark genug, um Inseln ins Meer und Seen ins Land zu
 *      stanzen. Sonst waere jede Region bildschirmweit einfarbig - genau
 *      der Fehler des ersten Entwurfs mit nur einem Feld.
 *   4. Ein RIDGED-Feld legt Gebirgszuege als Linien statt als Flecken an.
 */

import { FP_ONE, div, mul } from './fixed';
import { hash2i } from './hash';
import { fbm, ridgedFbm, warpOffset } from './noise';

export const Tile = {
  Water: 0,
  Sand: 1,
  Grass: 2,
  Forest: 3,
  Stone: 4,
  Mountain: 5,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export const TILE_NAMES: Record<Tile, string> = {
  [Tile.Water]: 'Wasser',
  [Tile.Sand]: 'Sand',
  [Tile.Grass]: 'Gras',
  [Tile.Forest]: 'Wald',
  [Tile.Stone]: 'Stein',
  [Tile.Mountain]: 'Berg',
};

/**
 * Konstante aus einem Literal. Wird einmal beim Laden ausgewertet;
 * Literal-Parsing und Multiplikation sind in IEEE-754 exakt festgelegt,
 * das Ergebnis ist also auf jeder Engine dieselbe Ganzzahl.
 */
const F = (n: number): number => Math.round(n * FP_ONE);

// --- Feldparameter -----------------------------------------------------

// Warping: grosse Zelle, damit die Verzerrung grossraeumig fliesst statt
// die Kueste nur auszufransen.
// Deutlich schwaechere Verzerrung als zuvor (54 Tiles bei Zelle 256).
//
// So stark verschoben, dreht sich das Hoehenfeld in sich selbst: beim
// Herauszoomen las sich die Karte als Strudel, weil die Verzerrung ueber
// mehrere Zellen hinweg dieselbe Drehrichtung behielt. Kleinere Zelle und
// halber Ausschlag geben Kuesten weiterhin Buchten und Halbinseln, ohne
// dass sich die Landschaft im Grossen verwirbelt.
const WARP_CELL_BITS = 6;
const WARP_TILES = 22;

// Kontinente: 2^10 = 1024 Tiles Zellweite - achtmal groesser als im
// Vorgaenger (128), dadurch Meere und Landmassen ueber mehrere Bildschirme.
//
// Entscheidend ist die SAETTIGUNG: das Feld wird stark verstaerkt (CONT_AMP)
// und dann gekappt (CONT_LIMIT). Ein blosses Gewichten funktioniert nicht -
// ein dominantes Tieffrequenzfeld erzeugt zwangslaeufig Regionen, die
// komplett Land oder komplett Meer sind. Durch das Kappen ist das Feld im
// Inneren einer Landmasse konstant; dort entscheidet allein das Detailfeld
// und stanzt Binnenseen hinein. Im offenen Meer entstehen umgekehrt Inseln.
//
// Ehrliche Messung ueber 200 zufaellig platzierte Fenster und 5 Seeds
// (Wasseranteil je Bildschirm):
//   vorher, ein Feld 2^7:   7 % .. 48 %, Median 24 %
//   jetzt:                  3 % .. 56 %, Median 23 %
// Die Streuung waechst also - das ist der Preis fuer groessere Strukturen,
// kein Fehler. Entscheidend ist die Obergrenze: kein einziges Fenster liegt
// ueber 60 % Wasser, es gibt also keine unbespielbaren Regionen.
const CONT_OCTAVES = 3;
const CONT_CELL_BITS = 10;
const CONT_GAIN = F(0.6);
const CONT_AMP = F(8);
const CONT_LIMIT = F(0.09);

// Detail: 2^6 = 64 Tiles. Bricht die Kontinente auf und liefert Kuestenlinien.
// Basiszelle 256 statt 64 Tiles, sechs Oktaven statt vier.
//
// Vorher deckte das Kontinentfeld die grossen Formen ab und das
// Detailfeld nur 64..8 Tiles - dazwischen klaffte eine Luecke, und genau
// die las sich als Kleckse: es gab grosse Formen und feines Rauschen,
// aber nichts dazwischen. Natuerliches Gelaende hat Struktur auf allen
// Groessen; mit 256 und sechs Oktaven schliesst das Detailfeld die Luecke.
const DETAIL_OCTAVES = 6;
const DETAIL_CELL_BITS = 8;
const DETAIL_GAIN = F(0.55);

const W_DETAIL = F(0.55);

// Gebirge als Grate. Grosse Zelle und wenige Oktaven: das ergibt lange,
// zusammenhaengende Ketten. Mehr Oktaven zerfasern sie wieder zu Flecken.
const RIDGE_OCTAVES = 3;
const RIDGE_CELL_BITS = 9;
const RIDGE_GAIN = F(0.5);

const FOREST_OCTAVES = 3;
const FOREST_CELL_BITS = 6;

// Seed-Versaetze, damit die Felder nicht miteinander korrelieren.
const S_WARP_X = 0x1b56c4e9 | 0;
const S_WARP_Y = 0x7f4a7c15 | 0;
const S_CONT = 0x2545f491 | 0;
const S_DETAIL = 0x9e3779b9 | 0;
const S_RIDGE = 0x3c6ef372 | 0;
const S_FOREST = 0x5bf03635 | 0;
const S_FOREST_JITTER = 0x68e31da4 | 0;
const S_RIVER = 0x41c64e6d | 0;
const S_RIVER_WARP = 0x6c078965 | 0;

// --- Schwellwerte ------------------------------------------------------
// An der GEMESSENEN Verteilung ausgerichtet, nicht geraten. FBM mittelt ueber
// Oktaven und streut deshalb nicht gleichmaessig ueber [-1,1], sondern in
// einem schmalen Band. Siehe PLAN.md.
// Zielanteile: 24% Wasser gesamt, 6% Sand. Vom Land etwa 60% Wald,
// 18% Fels und Gebirge (davon 7% Gipfel). Bewusst waldreich und
// gebirgig - die erste Fassung mit 44% Wald und 2% Gipfel wirkte zu
// gleichfoermig.
/** Ab hier gilt Wasser als voll ausgetieft - Bezugswert fuer waterDepth. */
const H_DEEP_FLOOR = F(-0.34);
const H_WATER = F(-0.078);
const H_SAND = F(-0.049);
// Weicher Hoehenanteil fuer die Gebirgsbildung: unterhalb H_HILL zaehlt nur
// der Grat, ab H_PEAK zaehlt die Hoehe voll.
// Deutlich hoeher als zuvor (0.05): Fels entstand sonst schon in
// maessigem Gelaende und lag als graue Flecken ueber der ganzen Karte
// verstreut. Erst ab echter Hoehe ergeben sich Ketten statt Flecken.
const H_HILL = F(0.14);
const H_PEAK = F(0.38);
const FOREST_THRESHOLD = F(-0.078);
// Streuung pro Tile an der Waldgrenze. Ohne sie folgt die Waldkante exakt
// einer Hoehenlinie des Noise-Feldes und die Landschaft bekommt ein
// Tarnmuster. Mit ihr franst der Rand aus - einzelne Baeume stehen noch im
// Grasland, einzelne Lichtungen noch im Wald.
const FOREST_JITTER = F(0.17);
// Perzentile des Gratfelds INNERHALB des Hochlands, nicht global.
// Schwellen auf den kombinierten Score aus Grat und Hoehe.
const SCORE_STONE = F(0.656);
const SCORE_MOUNTAIN = F(0.751);
// Die Hoehe zaehlt mehr als zuvor. Ein ueberwiegend gratgetriebener Score
// setzt Fels auch dort, wo das Gelaende flach ist - der Grat allein weiss
// nichts von Hoehe.
const W_RIDGE = F(0.52);
const W_ALTITUDE = F(0.48);

// --- Fluesse -----------------------------------------------------------
//
// Ein Fluss ist die Nulllinie eines Rauschfeldes: dort, wo das Feld sein
// Vorzeichen wechselt, liegt eine duenne, endlos lange Kurve. Alles was
// naeher als RIVER_WIDTH an dieser Linie liegt, wird Wasser.
//
// Warum so und nicht "Quelle suchen und bergab fliessen": auf einer
// unendlichen Karte gibt es keinen globalen Zustand, in dem man einem
// Lauf folgen koennte - jede Kachel muss allein aus (seed, x, y)
// entscheidbar bleiben. Die Nulllinie liefert genau das und ist trotzdem
// durchgehend, weil sie eine echte Kurve ist und nicht aus Stuecken
// zusammengesetzt.
//
// Wenige Oktaven mit grosser Zelle, sonst zerfasert die Linie in
// Maeander, die sich alle paar Kacheln selbst kreuzen.
const RIVER_OCTAVES = 3;
const RIVER_CELL_BITS = 9;
const RIVER_GAIN = F(0.45);
/** Eigene Verzerrung, damit Fluesse nicht den Kuestenlinien folgen. */
const RIVER_WARP_CELL_BITS = 7;
const RIVER_WARP_TILES = 26;
/** Halbe Flussbreite im Bergland und kurz vor der Muendung. */
const RIVER_WIDTH_HIGH = F(0.006);
const RIVER_WIDTH_LOW = F(0.020);
/**
 * Oberhalb dieser Hoehe versiegen Fluesse.
 *
 * Ohne die Grenze laufen sie ueber Gipfel hinweg, was ueberall dort
 * falsch aussieht, wo sie einen Grat queren statt ihn zu umgehen.
 */
const RIVER_MAX_HEIGHT = F(0.30);

export interface TerrainSample {
  tile: Tile;
  /** Kombinierte Hoehe in [-FP_ONE, FP_ONE] - fuer die Reliefschattierung. */
  height: number;
}

/**
 * Vollstaendige Auswertung an einer Position. generateTile und heightAt
 * greifen beide hierauf zu, damit der Renderer Hoehe und Kachelart in einem
 * Durchgang bekommt statt das Feld zweimal auszuwerten.
 */
export function sampleTerrain(seed: number, x: number, y: number): TerrainSample {
  // 1. Abfrageposition verzerren.
  const wx =
    x + warpOffset((seed ^ S_WARP_X) | 0, x, y, WARP_CELL_BITS, WARP_TILES);
  const wy =
    y + warpOffset((seed ^ S_WARP_Y) | 0, x, y, WARP_CELL_BITS, WARP_TILES);

  // 2. Kontinentfeld, verstaerkt und gekappt (siehe CONT_LIMIT).
  let cont = mul(
    fbm((seed ^ S_CONT) | 0, wx, wy, CONT_OCTAVES, CONT_CELL_BITS, CONT_GAIN),
    CONT_AMP,
  );
  if (cont > CONT_LIMIT) cont = CONT_LIMIT;
  else if (cont < -CONT_LIMIT) cont = -CONT_LIMIT;

  // 3. Detailfeld.
  const detail = fbm(
    (seed ^ S_DETAIL) | 0,
    wx,
    wy,
    DETAIL_OCTAVES,
    DETAIL_CELL_BITS,
    DETAIL_GAIN,
  );

  // mul() statt (a*b)>>16: das Rohprodukt erreicht hier 2^31 und wuerde beim
  // Shift auf int32 umlaufen.
  const height = (cont + mul(detail, W_DETAIL)) | 0;

  return { tile: classify(seed, x, y, wx, wy, height), height };
}

function classify(
  seed: number,
  x: number,
  y: number,
  wx: number,
  wy: number,
  height: number,
): Tile {
  if (height < H_WATER) return Tile.Water;
  // Fluesse VOR dem Sandsaum pruefen.
  //
  // Sonst legt sich der Uferstreifen quer ueber die Muendung und
  // unterbricht den Fluss genau dort, wo er ins Meer laufen soll - der
  // Wasserweg endet dann kurz vor der Kueste im Sand.
  if (isRiver(seed, x, y, height)) return Tile.Water;
  if (height < H_SAND) return Tile.Sand;

  // 4. Gebirge aus Grat UND Hoehe kombiniert.
  //
  // Ein harter Hoehenschnitt hat nicht funktioniert: die Grate entstanden dann
  // nur innerhalb der Hochlandblasen, waren entsprechend kurz und lasen sich
  // als graue Flecken. Mit einem weichen Hoehenanteil koennen sich Ketten
  // ueber die Blasengrenzen hinweg fortsetzen und laufen an den Enden aus.
  if (height > H_HILL) {
    const ridge = ridgedFbm(
      (seed ^ S_RIDGE) | 0,
      wx,
      wy,
      RIDGE_OCTAVES,
      RIDGE_CELL_BITS,
      RIDGE_GAIN,
    );
    let alt = div((height - H_HILL) | 0, (H_PEAK - H_HILL) | 0);
    if (alt > FP_ONE) alt = FP_ONE;
    const score = (mul(ridge, W_RIDGE) + mul(alt, W_ALTITUDE)) | 0;
    if (score > SCORE_MOUNTAIN) return Tile.Mountain;
    if (score > SCORE_STONE) return Tile.Stone;
  }

  const forest = fbm(
    (seed ^ S_FOREST) | 0,
    wx,
    wy,
    FOREST_OCTAVES,
    FOREST_CELL_BITS,
  );
  // Jitter auf den UNVERZERRTEN Koordinaten, sonst wiederholt das Warping
  // das Streumuster sichtbar.
  const jitter =
    (((hash2i(S_FOREST_JITTER, x, y) & 0xffff) - 0x8000) * FOREST_JITTER) >> 16;
  return forest + jitter > FOREST_THRESHOLD ? Tile.Forest : Tile.Grass;
}

export function generateTile(seed: number, x: number, y: number): Tile {
  return sampleTerrain(seed, x, y).tile;
}

export function heightAt(seed: number, x: number, y: number): number {
  return sampleTerrain(seed, x, y).height;
}

/**
 * Wassertiefe in [0, FP_ONE], 0 = Uferlinie, FP_ONE = Tiefsee.
 *
 * Bewusst ein Verlauf und keine Schwelle: mit einem harten Schnitt zwischen
 * "flach" und "tief" wirken die dunklen Bereiche wie zufaellige Flecken im
 * Wasser. Ein Verlauf liest sich dagegen als Tiefe und laesst Kuesten
 * flach auslaufen.
 *
 * Nur fuer die Einfaerbung - die Spiellogik kennt nur Tile.Water.
 */
/**
 * Liegt hier ein Fluss?
 *
 * Die Breite waechst zum Tiefland hin: oben ein Bach, unten ein Strom.
 * Das ergibt sich nicht von selbst aus dem Rauschen, sieht aber richtig
 * aus und laesst Fluesse an der Muendung ins Meer uebergehen, statt dort
 * abrupt zu enden.
 */
function isRiver(seed: number, x: number, y: number, height: number): boolean {
  if (height > RIVER_MAX_HEIGHT) return false;

  const wx =
    x + warpOffset((seed ^ S_RIVER_WARP) | 0, x, y, RIVER_WARP_CELL_BITS, RIVER_WARP_TILES);
  const wy =
    y +
    warpOffset((seed ^ S_RIVER_WARP ^ 0x5f5f) | 0, x, y, RIVER_WARP_CELL_BITS, RIVER_WARP_TILES);

  const field = fbm((seed ^ S_RIVER) | 0, wx, wy, RIVER_OCTAVES, RIVER_CELL_BITS, RIVER_GAIN);
  const dist = field < 0 ? -field : field;

  // 0 = knapp ueber dem Meer, FP_ONE = an der Versiegungsgrenze.
  let up = div((height - H_SAND) | 0, (RIVER_MAX_HEIGHT - H_SAND) | 0);
  if (up < 0) up = 0;
  if (up > FP_ONE) up = FP_ONE;
  const width =
    (RIVER_WIDTH_LOW + mul((RIVER_WIDTH_HIGH - RIVER_WIDTH_LOW) | 0, up)) | 0;

  return dist < width;
}

export function waterDepth(height: number): number {
  if (height >= H_WATER) return 0;
  const d = div((H_WATER - height) | 0, (H_WATER - H_DEEP_FLOOR) | 0);
  return d > FP_ONE ? FP_ONE : d;
}

/** Begehbar fuer Strassen und Gebaeude. */
export function isBuildable(t: Tile): boolean {
  return t === Tile.Grass || t === Tile.Sand || t === Tile.Forest;
}
