#!/usr/bin/env node

/**
 * Macht die auf Magenta gelieferten Sprites spielfertig.
 *
 * Der Prompt verlangt ein Motiv auf einfarbigem Magenta (#FF00FF), weil
 * Bildgeneratoren keine echte Transparenz liefern. Hier wird daraus ein
 * freigestelltes, zugeschnittenes und auf feste Groesse gebrachtes PNG.
 *
 * Freigestellt wird zweistufig. Kraeftiges Magenta gilt ueberall als
 * Hintergrund - auch eingeschlossen, denn beim offenen Unterstand sieht
 * man zwischen Dach und Pfosten hindurch, und diese Flaechen erreicht
 * eine Flutfuellung vom Rand aus nie. Blasses Magenta dagegen nur, wenn
 * es vom Rand aus zusammenhaengt: das ist der weiche Uebergang am
 * Motivrand, und ein rosastichiges Pixel mitten im Motiv soll bleiben,
 * sonst bekommt das Sprite Loecher.
 *
 * Der Saum um das Motiv wird zusaetzlich entfaerbt. Der Generator legt
 * einen weichen Uebergang zwischen Motiv und Hintergrund an; bleibt der
 * stehen, hat jedes Sprite im Spiel einen rosa Rand.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { decodePng, encodePng } from './png.mjs';

const SRC = path.resolve('art/generated-textures-v1/buildings');
const OUT = path.resolve('src/assets/medieval/buildings');
/** Kantenlaenge der Zielsprites. Wie die uebrigen Gebaeude. */
const SIZE = 192;

/** Was hier verarbeitet wird: Quellordner -> Zielordner und Dateinamen. */
const JOBS = [
  { from: 'depot', to: 'depot', files: ['depot_01', 'depot_02', 'depot_03', 'depot_04'] },
  { from: 'small_harbor', to: 'small_harbor', files: ['up', 'down', 'left', 'right'] },
];

/** Kraeftiges Magenta: sehr rot UND sehr blau, fast kein Gruen. */
function isPureMagenta(data, o) {
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  return r > 180 && b > 180 && g < 90 && Math.abs(r - b) < 60;
}

/** Blasses Magenta: der weiche Saum zum Hintergrund. */
function isMagenta(data, o) {
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  return r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 90;
}

/**
 * Hintergrundmaske per Flutfuellung vom Bildrand aus.
 *
 * Nur was vom Rand aus zusammenhaengend magenta ist, gilt als
 * Hintergrund - Magenta mitten im Motiv bleibt erhalten.
 */
function backgroundMask(image) {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const push = (i) => {
    if (mask[i] || !isMagenta(data, i * 4)) return;
    mask[i] = 1;
    queue[tail++] = i;
  };

  // Kraeftiges Magenta zaehlt ueberall, egal wo es liegt.
  for (let i = 0; i < mask.length; i++) {
    if (isPureMagenta(data, i * 4)) mask[i] = 1;
  }

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  return mask;
}

/**
 * Entfaerbt den rosa Saum am Motivrand.
 *
 * Am Uebergang mischt der Generator Motiv- und Hintergrundfarbe. Diese
 * Pixel bleiben sichtbar, sind aber magentastichig. Der Gruenanteil sagt,
 * wie viel Motiv darin steckt; danach wird Rot und Blau zurueckgenommen.
 */
function despill(data, o) {
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  const spill = Math.min(r, b) - g;
  if (spill <= 0) return;
  data[o] = Math.max(g, r - spill);
  data[o + 2] = Math.max(g, b - spill);
}

/** Enge Umrandung des sichtbaren Motivs. */
function bounds(mask, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * Zuschnitt auf Quadrat und Verkleinerung per Blockmittelwert.
 *
 * Quadratisch, weil der Renderer die Sprites ueber ihre Breite auf die
 * Grundflaeche legt; ein verzerrtes Seitenverhaeltnis wuerde das Gebaeude
 * stauchen. Der Zuschnitt wird um das Motiv zentriert.
 */
function cropScale(image, mask, box, size) {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const side = Math.max(w, h);
  const ox = box.x0 - ((side - w) >> 1);
  const oy = box.y0 - ((side - h) >> 1);
  const out = new Uint8Array(size * size * 4);
  const step = side / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      const sy0 = Math.floor(oy + y * step);
      const sy1 = Math.max(sy0 + 1, Math.floor(oy + (y + 1) * step));
      const sx0 = Math.floor(ox + x * step);
      const sx1 = Math.max(sx0 + 1, Math.floor(ox + (x + 1) * step));
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          n++;
          if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
          const i = sy * image.width + sx;
          if (mask[i]) continue;
          const o = i * 4;
          // Vormultipliziert mitteln, sonst faerbt der durchsichtige Rand
          // die Kante ein.
          r += image.data[o];
          g += image.data[o + 1];
          b += image.data[o + 2];
          a += 255;
        }
      }
      const o = (y * size + x) * 4;
      if (a === 0) continue;
      const cover = a / (n * 255);
      out[o] = Math.round(r / (a / 255));
      out[o + 1] = Math.round(g / (a / 255));
      out[o + 2] = Math.round(b / (a / 255));
      out[o + 3] = Math.round(cover * 255);
    }
  }
  return out;
}

async function main() {
  for (const job of JOBS) {
    await fs.mkdir(path.join(OUT, job.to), { recursive: true });
    for (const name of job.files) {
      const file = path.join(SRC, job.from, `${name}.png`);
      const image = decodePng(await fs.readFile(file));
      const mask = backgroundMask(image);

      // Saum entfaerben: alles, was bleibt und einen Hintergrundnachbarn hat.
      const { width, height } = image;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (mask[i]) continue;
          const near =
            (x > 0 && mask[i - 1]) ||
            (x < width - 1 && mask[i + 1]) ||
            (y > 0 && mask[i - width]) ||
            (y < height - 1 && mask[i + width]);
          if (near) despill(image.data, i * 4);
        }
      }

      const box = bounds(mask, width, height);
      const data = cropScale(image, mask, box, SIZE);
      const target = path.join(OUT, job.to, `${name}.png`);
      await fs.writeFile(target, encodePng(SIZE, SIZE, data));
      const kept = 1 - mask.reduce((a, v) => a + v, 0) / mask.length;
      console.log(
        `${job.to}/${name}  Motiv ${(kept * 100).toFixed(0)}% der Flaeche  -> ${SIZE}x${SIZE}`,
      );
    }
  }
}

await main();
