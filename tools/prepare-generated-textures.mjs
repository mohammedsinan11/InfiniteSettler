#!/usr/bin/env node

/**
 * Bereitet die einzeln generierten Texturen fuer das Spiel vor.
 *
 * - entfernt den irrtuemlich eingebrannten Schachbretthintergrund einiger
 *   ImageGen-Sprites per randverbundener Maske,
 * - schneidet Sprites zu und skaliert sie auf feste, kompakte Leinwaende,
 * - erzeugt aus jedem Terrainmotiv eine exakt nahtlose 32x32-Kachel.
 *
 * Die hochaufgeloesten Quellen bleiben unveraendert. Ausgabe:
 * art/generated-textures-v1/game-ready/
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { decodePng, encodePng } from './png.mjs';

const ROOT = path.resolve('art/generated-textures-v1');
const OUT = path.join(ROOT, 'game-ready');

const pixelOffset = (image, x, y) => (y * image.width + x) * 4;

function checkerCandidate(data, offset) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  return Math.min(r, g, b) >= 150 && Math.max(r, g, b) - Math.min(r, g, b) <= 52;
}

function magentaCandidate(data, offset) {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  return r >= 180 && b >= 180 && g <= 110 && Math.min(r, b) - g >= 90;
}

function removeEdgeBackground(image, candidate) {
  const { width, height, data } = image;
  const count = width * height;
  const background = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;

  const enqueue = (index) => {
    if (background[index] || !candidate(data, index * 4)) return;
    background[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const out = new Uint8Array(data);
  for (let i = 0; i < count; i++) {
    if (background[i]) out[i * 4 + 3] = 0;
  }
  return { width, height, data: out };
}

function removeEdgeCheckerboard(image) {
  return removeEdgeBackground(image, checkerCandidate);
}

function hasMagentaBackground(image) {
  const required = Math.max(1, Math.floor(image.width * image.height * 0.05));
  let matches = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (magentaCandidate(image.data, offset) && ++matches >= required) return true;
  }
  return false;
}

function removeMagenta(image) {
  const out = new Uint8Array(image.data);
  for (let offset = 0; offset < out.length; offset += 4) {
    if (magentaCandidate(out, offset)) {
      out[offset] = 0;
      out[offset + 1] = 0;
      out[offset + 2] = 0;
      out[offset + 3] = 0;
    }
  }
  return { width: image.width, height: image.height, data: out };
}

function alphaBounds(image) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[pixelOffset(image, x, y) + 3] <= 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('Bild enthaelt nach Freistellung kein Motiv');
  return { left, top, right, bottom };
}

function renderSprite(image, size, padding, alignBottom) {
  const bounds = alphaBounds(image);
  const sourceWidth = bounds.right - bounds.left + 1;
  const sourceHeight = bounds.bottom - bounds.top + 1;
  const available = size - padding * 2;
  const scale = Math.min(available / sourceWidth, available / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const offsetX = Math.floor((size - width) / 2);
  const offsetY = alignBottom ? size - padding - height : Math.floor((size - height) / 2);
  const out = new Uint8Array(size * size * 4);

  for (let y = 0; y < height; y++) {
    const sy = bounds.top + Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / height));
    for (let x = 0; x < width; x++) {
      const sx = bounds.left + Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / width));
      const source = pixelOffset(image, sx, sy);
      const target = ((offsetY + y) * size + offsetX + x) * 4;
      out[target] = image.data[source];
      out[target + 1] = image.data[source + 1];
      out[target + 2] = image.data[source + 2];
      out[target + 3] = image.data[source + 3];
    }
  }
  return { width: size, height: size, data: out };
}

function seamlessTerrain(image) {
  const baseSize = 16;
  const size = baseSize * 2;
  const base = new Uint8Array(baseSize * baseSize * 4);
  const square = Math.floor(Math.min(image.width, image.height) * 0.72);
  const left = Math.floor((image.width - square) / 2);
  const top = Math.floor((image.height - square) / 2);

  // Flaechenmittel statt Einzelpixel-Sampling: Das erhaelt beim starken
  // Verkleinern den mittleren Farbton und vermeidet zufaellige Ausreisser.
  for (let by = 0; by < baseSize; by++) {
    const y0 = top + Math.floor(by * square / baseSize);
    const y1 = top + Math.floor((by + 1) * square / baseSize);
    for (let bx = 0; bx < baseSize; bx++) {
      const x0 = left + Math.floor(bx * square / baseSize);
      const x1 = left + Math.floor((bx + 1) * square / baseSize);
      const sums = [0, 0, 0];
      let samples = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const source = pixelOffset(image, x, y);
          sums[0] += image.data[source];
          sums[1] += image.data[source + 1];
          sums[2] += image.data[source + 2];
          samples++;
        }
      }
      const target = (by * baseSize + bx) * 4;
      base[target] = Math.round(sums[0] / samples);
      base[target + 1] = Math.round(sums[1] / samples);
      base[target + 2] = Math.round(sums[2] / samples);
      base[target + 3] = 255;
    }
  }

  // Gespiegelte Wiederholung: linke/rechte sowie obere/untere Kante sind
  // pixelgenau gleich. Dadurch gibt es beim Kacheln keine sichtbare Naht.
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const by = y < baseSize ? y : size - 1 - y;
    for (let x = 0; x < size; x++) {
      const bx = x < baseSize ? x : size - 1 - x;
      const source = (by * baseSize + bx) * 4;
      const target = (y * size + x) * 4;
      out.set(base.subarray(source, source + 4), target);
    }
  }
  return { width: size, height: size, data: out };
}

/**
 * Uebernimmt ein im Prompt bereits als 32x32-Pixelraster erzeugtes Motiv.
 * Es wird weder gemittelt noch weichgezeichnet, gespiegelt oder an den
 * Kanten veraendert. Pro logischem Pixel wird genau ein Quellpixel gelesen.
 */
function sampleLogicalTile(image) {
  const size = 32;
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / size));
      const source = pixelOffset(image, sx, sy);
      const target = (y * size + x) * 4;
      out[target] = image.data[source];
      out[target + 1] = image.data[source + 1];
      out[target + 2] = image.data[source + 2];
      out[target + 3] = 255;
    }
  }
  return { width: size, height: size, data: out };
}

async function listPngs(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'game-ready') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listPngs(full));
    else if (entry.isFile() && entry.name.endsWith('.png')) result.push(full);
  }
  return result;
}

const files = await listPngs(ROOT);
for (const file of files.sort()) {
  const relative = path.relative(ROOT, file);
  const category = relative.split(path.sep)[0];
  let image = decodePng(await fs.readFile(file));
  let prepared;

  if (category === 'terrain' || category === 'roads') {
    prepared = sampleLogicalTile(image);
  } else {
    const hasTransparency = image.data.some((value, index) => index % 4 === 3 && value < 250);
    if (hasMagentaBackground(image)) image = removeMagenta(image);
    else if (!hasTransparency) image = removeEdgeCheckerboard(image);
    if (category === 'buildings') prepared = renderSprite(image, 192, 6, true);
    else if (category === 'ships') prepared = renderSprite(image, 128, 4, false);
    else if (category === 'goods') prepared = renderSprite(image, 32, 2, false);
    else continue;
  }

  const destination = path.join(OUT, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, encodePng(prepared.width, prepared.height, prepared.data));
}

console.log(`${files.length} Einzelbilder nach ${path.relative(process.cwd(), OUT)} aufbereitet.`);
