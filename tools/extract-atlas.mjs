/**
 * Schneidet Einzelbilder aus preview/atlas_reference.png neu heraus.
 *
 * Warum es das gibt: die mitgelieferten Einzeldateien in assets/ sind mit
 * einem falschen Raster geschnitten. Jede Datei ist vertikal verschoben,
 * und zwar unterschiedlich weit - bei den Terrainkacheln fehlen oben zwei
 * bis sieben Zeilen, bei den Gebaeuden zehn bis sechzehn, wodurch unten
 * der Sockel abgeschnitten ist. Die fehlenden Zeilen stehen nicht in den
 * Dateien, sie sind aus sich heraus also nicht reparierbar. Der Atlas ist
 * die einzige vollstaendige Quelle.
 *
 * Drei Schnittverfahren, weil die Kategorien unterschiedlich aufgebaut sind:
 *
 *   'grid'  fuer Terrain und Gebaeude. Die Rasterweite wird aus der bekannten
 *           Spaltenzahl abgeleitet; explizite Zeilenbaender halten die
 *           Atlasbeschriftungen ausserhalb des Ergebnisses.
 *           (Einzelne Luecken zu suchen scheitert, wenn zwei Nachbarkacheln
 *           an der Grenze beide hell sind; Autokorrelation rastet auf
 *           Vielfachen der Rasterweite ein.)
 *
 *   'minima' fuer Baeume. Sie sind ungleichmaessig verteilt (starres Raster
 *           schneidet mitten hindurch) UND ihre Kronen ueberlappen
 *           (Laufsuche verklebt sie zu einem Block). Da die Anzahl je Zeile
 *           bekannt ist, werden stattdessen die n-1 duennsten Stellen im
 *           Dichteprofil als Schnittkanten genommen - mit Mindestabstand,
 *           damit nicht mehrere Schnitte in dieselbe Luecke fallen.
 *
 *   'runs'  fuer Sprites. Rohstoffe, Tiere und Einheiten stehen frei auf dem
 *           Panelhintergrund. Dort ist ein starres Raster gerade falsch -
 *           die Abstaende sind ungleichmaessig und manche Zeilen haben
 *           weniger Eintraege. Stattdessen werden zusammenhaengende
 *           Inhaltslaeufe gesucht: jeder Lauf ist ein Sprite. Die Anzahl
 *           ergibt sich dabei von selbst und wird zur Kontrolle ausgegeben.
 *
 * Danach jeweils: Panelhintergrund per Flutfuellung vom Rand entfernen,
 * auf den Inhalt zuschneiden, auf die Zielgroesse skalieren.
 *
 * Ergebnis (171 Dateien):
 *   terrain    8 Varianten x 7 Arten, 32x32, deckend
 *   buildings  4 Varianten x 5 Typen, 96x96, transparent
 *   trees      3 Zeilen x ~8, transparent
 *   resources  6 Varianten x 5 Arten, transparent
 *   animals    4 Bilder x 4 Arten, transparent
 *   units      7 Ansichten x 4 Arten, transparent
 *
 * Bekannte Grenzen:
 *   - Die Baumzeilen sind der schwierigste Fall. Mehrere Baeume werden falsch
 *     geteilt, weil sich ihre Kronen im Atlas ueberlappen. Das Spielmanifest
 *     nimmt deshalb nur neun einzeln gepruefte Ergebnisse auf.
 *   - Im Atlas sind die Kacheln rund 42 px gross, nicht 32. Die "32x32"
 *     des Packs waren nie native Pixelart. Beim Skalieren wird deshalb
 *     zwangslaeufig neu abgetastet, was die Kanten etwas weicher macht.
 *   - Die Terrainkacheln sind nicht nahtlos. Sie wiederholen sich im
 *     Spiel sichtbar, wenn man sie ohne Variantenwechsel nebeneinander
 *     legt.
 *
 * Aufruf:  node tools/extract-atlas.mjs [--out <verzeichnis>] [--only <kategorie>]
 *
 * Schreibt nach <verzeichnis> (Standard: texture pack/.../extracted) und
 * fasst das Ergebnis in der Konsole zusammen. Die Originaldateien in
 * assets/ werden nicht angefasst.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

const PACK = 'texture pack/medieval_texture_pack_v0.1';
const ATLAS = join(PACK, 'preview/atlas_reference.png');
/**
 * Zweite Vorlage. Anderes Blatt, anderer Aufbau - deshalb tragen die
 * Kategorien ein eigenes `source`. Diese hier ist die bessere: saubere
 * 32er-Kacheln, dazu Strassenkreuzungen und Wasser-Ufer-Uebergaenge, die
 * im ersten Blatt fehlten.
 */
const ATLAS2 = 'texture pack/image.png';

/**
 * Grobe Boxen aus dem Atlas. Sie muessen die Zellen umschliessen und die
 * Beschriftungen daneben AUSSCHLIESSEN - genau daran ist die urspruengliche
 * Extraktion gescheitert: die Zeilenbeschriftung ist bei jeder ersten
 * Variante mit im Bild gelandet ("Lumberjack Hut (4)").
 *
 * Die Kanten werden anschliessend automatisch auf den Inhalt eingeengt,
 * die Werte muessen also nicht pixelgenau sein - nur eng genug.
 */
const CATEGORIES = [
  // --- zweite Vorlage: image.png ---------------------------------------
  // Die Beschriftung steht UNTER jeder Kachel, nicht daneben. Deshalb
  // explizite Zeilenbaender, die nur die Kachel umfassen.
  { name: 'g2_grass', source: ATLAS2, mode: 'grid', box: [8, 43, 378, 231],
    cols: 4, rows: 2, rowBands: [[40, 119], [160, 239]],
    rowNames: ['grass', 'grass_b'], out: 0, inset: 3, transparent: false,
    dir: () => 'g2/terrain', flat: true },
  { name: 'g2_forest', source: ATLAS2, mode: 'grid', box: [395, 43, 760, 231],
    cols: 4, rows: 2, rowBands: [[40, 119], [160, 239]],
    rowNames: ['forest_ground', 'forest_ground_b'], out: 0, inset: 3,
    transparent: false, dir: () => 'g2/terrain', flat: true },
  { name: 'g2_dirt', source: ATLAS2, mode: 'grid', box: [778, 43, 1140, 231],
    cols: 4, rows: 2, rowBands: [[40, 119], [160, 239]],
    rowNames: ['dirt', 'dirt_b'], out: 0, inset: 3, transparent: false,
    dir: () => 'g2/terrain', flat: true },
  { name: 'g2_road', source: ATLAS2, mode: 'grid', box: [1158, 43, 1528, 231],
    cols: 4, rows: 2, rowBands: [[40, 119], [160, 239]],
    rowNames: ['road', 'road_b'], out: 0, inset: 3, transparent: false,
    dir: () => 'g2/terrain', flat: true },
  { name: 'g2_water', source: ATLAS2, mode: 'grid', box: [8, 322, 378, 512],
    cols: 4, rows: 2, rowBands: [[320, 399], [440, 519]],
    rowNames: ['water', 'water_b'], out: 0, inset: 3, transparent: false,
    dir: () => 'g2/terrain', flat: true },
  { name: 'g2_trees', source: ATLAS2, mode: 'grid', box: [410, 318, 790, 562],
    cols: 4, rows: 2, rowBands: [[320, 424], [452, 556]],
    rowNames: ['oak', 'pine'], out: 0, inset: 2, transparent: true,
    dir: () => 'g2/trees' },
  { name: 'g2_plants', source: ATLAS2, mode: 'grid', box: [826, 320, 1160, 575],
    cols: 4, rows: 3, rowBands: [[322, 388], [410, 476], [498, 564]],
    rowNames: ['bush', 'plant', 'flower'], out: 0, inset: 2, transparent: true,
    dir: () => 'g2/plants' },
  { name: 'g2_rocks', source: ATLAS2, mode: 'grid', box: [1186, 320, 1530, 575],
    cols: 4, rows: 3, rowBands: [[322, 388], [410, 476], [498, 564]],
    rowNames: ['rock', 'timber', 'fence'], out: 0, inset: 2, transparent: true,
    dir: () => 'g2/rocks' },
  // Raster statt Laeufe: die Gebaeude stehen dicht an dicht und ihre
  // Baeume beruehren sich, die Laufsuche fand nur einen einzigen Block.
  { name: 'g2_buildings', source: ATLAS2, mode: 'grid', box: [858, 638, 1522, 925],
    cols: 4, rows: 2, rowBands: [[640, 768], [800, 908]],
    rowNames: ['house', 'sawmill'], out: 0, inset: 2, transparent: true,
    dir: () => 'g2/buildings' },

  {
    name: 'terrain',
    mode: 'grid',
    box: [68, 41, 404, 391],
    cols: 8,
    rows: 7,
    rowNames: ['grass', 'dirt', 'sand', 'road', 'water', 'forest_ground', 'snow'],
    // Die Rasterzeilen enthalten deutlich mehr vertikalen Zwischenraum als
    // horizontal. Explizite Inhaltsbaender verhindern, dass der blaue
    // Panelverlauf am unteren Kachelrand mit skaliert wird.
    rowBands: [
      [41, 80],
      [91, 130],
      [140, 179],
      [190, 228],
      [239, 277],
      [289, 327],
      [338, 378],
    ],
    out: 32,
    // Der dunkle Zwischenraum wird pro Zelle automatisch entfernt. Ein
    // pauschales Inset wuerde dagegen an unterschiedlich ausgerichteten
    // Zeilen echte Randpixel abschneiden.
    inset: 0,
    insetX: 3,
    transparent: false, // Terrain fuellt die Kachel vollstaendig
    dir: () => 'terrain',
  },
  {
    name: 'buildings',
    mode: 'grid',
    // Die erste Fassung begann bei x=855, also mitten im jeweils ersten
    // Gebaeude. Die Spalten muessen am linken Panelrand beginnen; die
    // Beschriftungen werden stattdessen ueber die expliziten Zeilenbaender
    // ausgeschlossen.
    box: [790, 34, 1323, 624],
    cols: 4,
    rows: 5,
    rowNames: ['house', 'lumberjack_hut', 'sawmill', 'warehouse', 'farm'],
    out: 0,
    rowBands: [
      [34, 145],
      [166, 264],
      [285, 379],
      [400, 501],
      [520, 624],
    ],
    inset: 2,
    transparent: true,
    dir: (row) => `buildings/${row}`,
  },
  {
    // Baeume sind der schwierige Fall: ungleichmaessig verteilt (starres
    // Raster schneidet mitten hindurch) und die Kronen beruehren sich
    // (einfache Laufsuche verklebt sie). Loesung ist ein hoeherer
    // Dichteschwellwert - eine Spalte zaehlt erst als belegt, wenn genug
    // Pixel darin stehen. Damit trennt der Schnitt an den duennen
    // Beruehrpunkten zwischen zwei Kronen.
    name: 'trees',
    mode: 'minima',
    box: [470, 40, 793, 390],
    cols: 8,
    rowNames: ['oak', 'pine', 'pine_tall'],
    out: 0,
    transparent: true,
    dir: () => 'trees',
  },
  {
    name: 'resources',
    mode: 'runs',
    box: [55, 420, 345, 695],
    rowNames: ['wood', 'stone', 'iron', 'wheat', 'berries'],
    out: 32,
    transparent: true,
    dir: () => 'resources',
  },
  {
    // Zaeune, Faesser, Brunnen, Karren UND Vegetation gemischt - welche
    // davon brauchbar sind, entscheidet sich beim Ansehen.
    name: 'decorations',
    mode: 'runs',
    box: [10, 735, 285, 1015],
    rowNames: ['deco_a', 'deco_b', 'deco_c', 'deco_d'],
    out: 0,
    transparent: true,
    dir: () => 'decorations',
  },
  {
    name: 'animals',
    mode: 'runs',
    box: [845, 685, 1045, 862],
    rowNames: ['cow', 'sheep', 'horse', 'chicken'],
    out: 40,
    transparent: true,
    dir: () => 'animals',
  },
  {
    // Die Atlas-Texte unter den Figuren sind nur rund zehn Pixel hoch und
    // werden von contentRuns(minRun=20) verworfen. Uebrig bleiben die vier
    // eigentlichen Figurenzeilen.
    name: 'units',
    mode: 'runs',
    box: [410, 420, 786, 690],
    rowNames: ['worker', 'lumberjack', 'farmer', 'soldier'],
    out: 32,
    transparent: true,
    dir: () => 'units',
  },
];

// --- Bildhilfen --------------------------------------------------------

const at = (img, x, y) => (y * img.width + x) * 4;

/** Panel-Hintergrund: dunkel und wenig gesaettigt. */
function isBackground(img, x, y) {
  const k = at(img, x, y);
  const r = img.data[k], g = img.data[k + 1], b = img.data[k + 2];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  // Sehr dunkle Pixel sind immer Hintergrund. Bei fast schwarzen Farben
  // ist die rechnerische Saettigung bedeutungslos - ein Unterschied von
  // wenigen Stufen zwischen den Kanaelen ergibt schon 0.5, und der
  // Panelhintergrund der zweiten Vorlage (19,30,36) fiel deshalb faelschlich
  // als Inhalt durch.
  if (mx <= 48) return true;
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  return mx <= 78 && sat <= 0.45;
}

/** Engt eine Box auf tatsaechlichen Inhalt ein. */
function refine([x0, y0, x1, y1], img) {
  const hasContent = (fixed, kind) => {
    if (kind === 'col') {
      for (let y = y0; y < y1; y++) if (!isBackground(img, fixed, y)) return true;
    } else {
      for (let x = x0; x < x1; x++) if (!isBackground(img, x, fixed)) return true;
    }
    return false;
  };
  let a = x0, b = x1 - 1, c = y0, d = y1 - 1;
  while (a < b && !hasContent(a, 'col')) a++;
  while (b > a && !hasContent(b, 'col')) b--;
  while (c < d && !hasContent(c, 'row')) c++;
  while (d > c && !hasContent(d, 'row')) d--;
  return [a, c, b + 1, d + 1];
}

/**
 * Hintergrund vom Rand her wegfluten. Bewusst nur vom Rand: ein dunkler
 * Fleck INNERHALB eines Gebaeudes (Fensteroeffnung, Schatten) soll nicht
 * durchsichtig werden.
 */
function clearBackground(cell) {
  const { width: w, height: h, data } = cell;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (!seen[i]) { seen[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  let cleared = 0;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    if (!isBackground(cell, x, y)) continue;
    data[i * 4 + 3] = 0;
    cleared++;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return cleared;
}

/**
 * Laeufe zusammenhaengenden Inhalts entlang einer Achse.
 * minRun filtert Beschriftungsreste und einzelne Streupixel weg.
 */
function contentRuns(img, [x0, y0, x1, y1], axis, minRun, minDensity) {
  const outer = axis === 'x' ? [x0, x1] : [y0, y1];
  const inner = axis === 'x' ? [y0, y1] : [x0, x1];
  const dense = [];
  for (let a = outer[0]; a < outer[1]; a++) {
    let n = 0;
    for (let b = inner[0]; b < inner[1]; b++) {
      const [px, py] = axis === 'x' ? [a, b] : [b, a];
      if (!isBackground(img, px, py)) n++;
    }
    dense.push(n >= minDensity);
  }
  const runs = [];
  let start = null;
  for (let i = 0; i <= dense.length; i++) {
    if (i < dense.length && dense[i] && start === null) start = i;
    else if ((i === dense.length || !dense[i]) && start !== null) {
      if (i - start >= minRun) runs.push([outer[0] + start, outer[0] + i]);
      start = null;
    }
  }
  return runs;
}

/**
 * Teilt ein Dichteprofil in n Abschnitte, indem die n-1 duennsten Stellen
 * als Schnitte gewaehlt werden. minGap verhindert, dass mehrere Schnitte in
 * dieselbe Luecke fallen.
 */
function splitAtMinima(profile, n, minGap) {
  const order = profile
    .map((v, i) => [v, i])
    .sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  const cuts = [];
  for (const [, i] of order) {
    if (cuts.length >= n - 1) break;
    if (i < minGap || i > profile.length - minGap) continue;
    if (cuts.some((c) => Math.abs(c - i) < minGap)) continue;
    cuts.push(i);
  }
  cuts.sort((a, b) => a - b);
  const edges = [0, ...cuts, profile.length];
  return edges.slice(0, -1).map((a, i) => [a, edges[i + 1]]);
}

/** Anteil der Zellrandpixel, die Inhalt tragen. */
function edgeCoverage(img) {
  const { width: w, height: h } = img;
  let n = 0;
  let total = 0;
  const test = (x, y) => { total++; if (img.data[at(img, x, y) + 3] >= 24) n++; };
  for (let x = 0; x < w; x++) { test(x, 0); test(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { test(0, y); test(w - 1, y); }
  return total === 0 ? 0 : n / total;
}

function contentBox(img) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[at(img, x, y) + 3] < 24) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

function crop(img, [x0, y0, x1, y1]) {
  const w = x1 - x0, h = y1 - y0;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = at(img, x0 + x, y0 + y);
      const d = (y * w + x) * 4;
      data[d] = img.data[s]; data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2]; data[d + 3] = img.data[s + 3];
    }
  }
  return { width: w, height: h, data };
}

/**
 * Flaechenmittelung. Alpha-gewichtet, sonst zieht der Mittelwert die Farbe
 * transparenter Pixel in die Kanten und Sprites bekommen dunkle Saeume.
 */
function resize(img, tw, th) {
  const data = new Uint8Array(tw * th * 4);
  const sx = img.width / tw, sy = img.height / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.ceil((y + 1) * sy));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.ceil((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < Math.min(y1, img.height); yy++) {
        for (let xx = x0; xx < Math.min(x1, img.width); xx++) {
          const k = at(img, xx, yy);
          const al = img.data[k + 3];
          r += img.data[k] * al; g += img.data[k + 1] * al; b += img.data[k + 2] * al;
          a += al; n++;
        }
      }
      const d = (y * tw + x) * 4;
      if (a > 0) {
        data[d] = Math.round(r / a); data[d + 1] = Math.round(g / a);
        data[d + 2] = Math.round(b / a); data[d + 3] = Math.round(a / n);
      }
    }
  }
  return { width: tw, height: th, data };
}

// --- Hauptlauf ---------------------------------------------------------

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const outRoot = argOf('--out', join(PACK, 'extracted'));
const only = argOf('--only', null);
/** Nur zum Ausprobieren: ueberschreibt den Einzug aller Kategorien. */
const insetOverride = args.includes('--inset') ? Number(argOf('--inset', '0')) : null;

const sources = new Map();
const atlasFor = (path) => {
  const key = path ?? ATLAS;
  if (!sources.has(key)) sources.set(key, decodePng(readFileSync(key)));
  return sources.get(key);
};
console.log(`Ziel: ${outRoot}\n`);

let written = 0;
const warnings = [];

/** Schreibt ein Einzelbild: Hintergrund weg, zuschneiden, skalieren. */
function emit(cell, cat, rowName, index) {
  // Auch Terrain zuerst freistellen: seine Atlaszellen enthalten verschieden
  // breite dunkle Zwischenraeume. Erst nach dem Entfernen kennen wir die
  // tatsaechliche Kachelbox. Beim Zeichnen liegt unter den PNGs weiterhin die
  // prozedurale Grundfarbe, deshalb sind transparente Eckpixel unkritisch.
  clearBackground(cell);

  let piece = cell;
  const cb = contentBox(cell);
  if (!cb) return false;
  piece = crop(cell, cb);
  if (cat.transparent) {
    // Bei 'minima' wird eine feste Anzahl Schnitte erzwungen. Hat eine Zeile
    // real weniger Eintraege, entstehen dabei fast leere Zellen - die
    // werden verworfen statt als kaputte Datei geschrieben.
    let opaque = 0;
    for (let i = 0; i < cell.width * cell.height; i++) {
      if (cell.data[i * 4 + 3] >= 24) opaque++;
    }
    if (opaque / (cell.width * cell.height) < 0.1) return false;
    // Nur warnen, wenn ein nennenswerter Teil der Kante belegt ist. Grosse
    // Gebaeude fuellen ihre Zelle fast aus und beruehren den Rand mit
    // einzelnen Pixeln, ohne dass etwas fehlt.
    const edge = edgeCoverage(cell);
    if (edge > 0.2) {
      warnings.push(
        `${cat.name}/${rowName}_${index}: ${(edge * 100).toFixed(0)}% des Zellrands belegt`
        + ' - moeglicherweise abgeschnitten');
    }
  }

  // out: 0 heisst "nicht skalieren".
  //
  // Jede Skalierung tastet neu ab und macht Pixelart weich. Die Motive
  // liegen im Atlas ohnehin nicht in einer runden Zielgroesse vor, ein
  // Herunterrechnen auf 96 kostete also nur Schaerfe. Der Renderer
  // skaliert beim Zeichnen sowieso auf die Zoomstufe.
  const target =
    cat.out === 0
      ? piece
      : cat.transparent
        ? (() => {
            const k = cat.out / Math.max(piece.width, piece.height);
            return resize(piece, Math.max(1, Math.round(piece.width * k)),
                                 Math.max(1, Math.round(piece.height * k)));
          })()
        : resize(piece, cat.out, cat.out);

  const path = join(outRoot, cat.dir(rowName),
                    `${rowName}_${String(index).padStart(2, '0')}.png`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(target.width, target.height, target.data));
  written++;
  return true;
}

for (const cat of CATEGORIES) {
  if (only && only !== cat.name) continue;
  const atlas = atlasFor(cat.source);
  const box = refine(cat.box, atlas);
  const inset = insetOverride ?? cat.inset ?? 0;

  if (cat.mode === 'grid') {
    const cw = (box[2] - box[0]) / cat.cols;
    const rh = (box[3] - box[1]) / cat.rows;
    const insetX = cat.insetX ?? inset;
    const insetY = cat.insetY ?? inset;
    console.log(`${cat.name} [grid]: Box ${box.join(',')}  Zelle ${cw.toFixed(1)}x${rh.toFixed(1)}`);
    for (let r = 0; r < cat.rows; r++) {
      const rowName = cat.rowNames[r] ?? `row${r + 1}`;
      const row = cat.rowBands?.[r] ?? [
        Math.round(box[1] + r * rh),
        Math.round(box[1] + (r + 1) * rh),
      ];
      for (let c = 0; c < cat.cols; c++) {
        emit(crop(atlas, [
          Math.round(box[0] + c * cw) + insetX,
          row[0] + insetY,
          Math.round(box[0] + (c + 1) * cw) - insetX,
          row[1] - insetY,
        ]), cat, rowName, c + 1);
      }
    }
    continue;
  }

  // runs / minima: erst Zeilenbaender, dann die Sprites darin.
  // Mindesthoehe 20 px: darunter sind es Beschriftungsreste, keine Sprite-Zeilen.
  const bands = contentRuns(atlas, box, 'y', 20, 3);
  console.log(`${cat.name} [${cat.mode}]: Box ${box.join(',')}  ${bands.length} Zeilenbaender`);
  bands.forEach((band, r) => {
    const rowName = cat.rowNames[r] ?? `row${r + 1}`;
    let cols;
    if (cat.mode === 'minima') {
      const dens = [];
      for (let x = box[0]; x < box[2]; x++) {
        let n = 0;
        for (let y = band[0]; y < band[1]; y++) if (!isBackground(atlas, x, y)) n++;
        dens.push(n);
      }
      const minGap = Math.floor((box[2] - box[0]) / cat.cols / 2);
      cols = splitAtMinima(dens, cat.cols, minGap)
        .map(([a, b]) => [box[0] + a, box[0] + b]);
    } else {
      cols = contentRuns(atlas, [box[0], band[0], box[2], band[1]], 'x', 10,
                         cat.runDensity ?? 2);
    }
    console.log(`   ${rowName.padEnd(12)} y ${band[0]}..${band[1]}  ${cols.length} Kandidaten`);
    let kept = 0;
    for (const col of cols) {
      if (emit(crop(atlas, [col[0], band[0], col[1], band[1]]), cat, rowName, kept + 1)) kept++;
    }
    if (kept !== cols.length) {
      console.log(`   ${' '.repeat(12)} ${cols.length - kept} leere Zellen verworfen`);
    }
  });
}

console.log(`\n${written} Dateien geschrieben.`);
if (warnings.length) {
  console.log(`\n${warnings.length} Hinweise:`);
  for (const wn of warnings.slice(0, 20)) console.log('  - ' + wn);
  if (warnings.length > 20) console.log(`  ... und ${warnings.length - 20} weitere`);
}
