#!/usr/bin/env node

/**
 * Bringt die v2-Bodenkacheln auf ihre native Groesse.
 *
 * Der Bildgenerator liefert 1254 x 1254 grosse PNGs, deren Inhalt aber
 * ein logisches 32er-Raster ist - jeder Logikpixel steht rund 39 mal im
 * Bild. Hier wird exakt dieses Raster zurueckgewonnen: je Zielpixel der
 * Mittelwert seines Quellblocks. Das ist keine Weichzeichnung, sondern
 * die Umkehrung der Vergroesserung; die Kanten bleiben, wo sie sind.
 *
 * Bewusst KEINE Kantenkorrektur, keine Spiegelung, kein Ueberblenden:
 * die Quellen sind bereits nahtlos (gemessen in tools/atlas-prompt.md),
 * und jeder Eingriff wuerde genau das wieder kaputt machen.
 *
 * Was dagegen noetig ist: die sechs Varianten einer Kategorie auf einen
 * gemeinsamen Farbton bringen. Geliefert unterscheiden sie sich nicht nur
 * in der Koernung, sondern im Grundton - Sand reicht von blassem Creme
 * bis Rotbraun. Nebeneinander gelegt ergibt das einen Flickenteppich
 * statt einer Flaeche. Jede Kachel wird deshalb um eine KONSTANTE
 * verschoben, bis ihr Mittelwert dem der Kategorie entspricht. Eine
 * Konstante je Kachel laesst die Naht unberuehrt, weil sie beide Kanten
 * gleich verschiebt; die Koernung bleibt vollstaendig erhalten.
 *
 * Quelle: art/generated-textures-v2/terrain/<art>/<art>_0n.png
 * Ziel:   src/assets/medieval/ground/ground_<art>_0n.png
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { decodePng, encodePng } from './png.mjs';

const SRC = path.resolve('art/generated-textures-v2/terrain');
const OUT = path.resolve('src/assets/medieval/ground');
/** Kantenlaenge der Zielkachel in Pixeln. */
const SIZE = 32;

/** Mittelwert je Quellblock - die Umkehrung der Vergroesserung. */
function downscale(image, size) {
  const out = new Uint8Array(size * size * 4);
  const sx = image.width / size;
  const sy = image.height / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      const y0 = Math.floor(y * sy);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      for (let yy = y0; yy < y1 && yy < image.height; yy++) {
        for (let xx = x0; xx < x1 && xx < image.width; xx++) {
          const o = (yy * image.width + xx) * 4;
          r += image.data[o];
          g += image.data[o + 1];
          b += image.data[o + 2];
          a += image.data[o + 3];
          n++;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/**
 * Nahtmass einer Kachel.
 *
 * Mittlere Farbdifferenz ueber die Kachelnaht, geteilt durch die mittlere
 * Differenz benachbarter Pixel INNERHALB der Kachel. 1.0 heisst: die Naht
 * faellt nicht mehr auf als ein normaler Nachbarschritt.
 */
function seamRatio(data, size) {
  const at = (x, y) => {
    const o = ((y % size) * size + (x % size)) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  const diff = (a, b) =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

  let edge = 0;
  let inner = 0;
  for (let y = 0; y < size; y++) {
    edge += diff(at(size - 1, y), at(0, y));
    for (let x = 0; x < size - 1; x++) inner += diff(at(x, y), at(x + 1, y));
  }
  for (let x = 0; x < size; x++) {
    edge += diff(at(x, size - 1), at(x, 0));
    for (let y = 0; y < size - 1; y++) inner += diff(at(x, y), at(x, y + 1));
  }
  const innerAvg = inner / (2 * size * (size - 1));
  return edge / (2 * size) / Math.max(innerAvg, 0.001);
}

/** Mittlere Farbe einer Kachel. */
function meanColor(data) {
  const sum = [0, 0, 0];
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
  }
  return sum.map((v) => v / n);
}

/** Verschiebt die Kachel um eine Konstante auf den Zielmittelwert. */
function shiftToMean(data, target) {
  const mean = meanColor(data);
  const d = [target[0] - mean[0], target[1] - mean[1], target[2] - mean[2]];
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const v = data[i + k] + d[k];
      data[i + k] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const kinds = (await fs.readdir(SRC, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const kind of kinds) {
    const dir = path.join(SRC, kind);
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort();
    const tiles = [];
    for (const file of files) {
      const image = decodePng(await fs.readFile(path.join(dir, file)));
      tiles.push({ file, data: downscale(image, SIZE) });
    }

    // Zielton der Kategorie: Mittel ueber alle Varianten. Der Abstand der
    // weitesten Variante davon wird mitprotokolliert - er zeigt, wie
    // uneinheitlich der gelieferte Satz war.
    const means = tiles.map((t) => meanColor(t.data));
    const target = [0, 1, 2].map(
      (k) => means.reduce((a, m) => a + m[k], 0) / means.length,
    );
    const spread = Math.max(
      ...means.map((m) => Math.max(...[0, 1, 2].map((k) => Math.abs(m[k] - target[k])))),
    );

    const ratios = [];
    for (const t of tiles) {
      shiftToMean(t.data, target);
      ratios.push(seamRatio(t.data, SIZE));
      await fs.writeFile(path.join(OUT, `ground_${t.file}`), encodePng(SIZE, SIZE, t.data));
    }
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    console.log(
      `${kind.padEnd(15)} ${String(files.length).padStart(2)} Kacheln` +
        `  Naht ${avg.toFixed(2)}  Farbdrift vorher ${spread.toFixed(0)}`,
    );
  }
}

await main();
