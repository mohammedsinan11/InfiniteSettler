/**
 * Schneidet ein Sprite auf sein eigentliches Motiv zurueck.
 *
 * Die Sprites aus dem v0.2-Paket tragen den Dateinamen als Text unter dem
 * Motiv und einen gestrichelten Auswahlrahmen darum - beides stammt aus
 * der beschrifteten Vorschau, aus der das Paket geschnitten wurde. Beides
 * haengt aber NICHT mit dem Motiv zusammen: es sind eigene Inselchen im
 * Bild.
 *
 * Deshalb genuegt eine Zusammenhangsanalyse: die groesste zusammenhaengende
 * Flaeche ist das Motiv, alles andere faellt weg. Kleine Teile, die dicht
 * am Motiv liegen (Schornstein, Zaunpfosten, Baum daneben) bleiben
 * erhalten - sie werden ueber ihren Abstand zur Hauptflaeche einbezogen.
 *
 * Aufruf: node tools/trim-sprite.mjs <quelle> <ziel> [--pad N]
 *         node tools/trim-sprite.mjs <quellordner> <zielordner> [--pad N]
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { decodePng, encodePng } from './png.mjs';

/** Wieviel Abstand ein Teil zur Hauptflaeche haben darf, um dazuzugehoeren. */
const NEAR = 6;
/** Teile unter diesem Anteil der Hauptflaeche gelten als Beiwerk. */
const KEEP_RATIO = 0.02;

/**
 * "Kern" eines Bildes: deckende Pixel, die selbst von deckenden Pixeln
 * umgeben sind.
 *
 * Der gestrichelte Auswahlrahmen der Vorlage ist einen Pixel duenn und
 * beruehrt sowohl das Gebaeude als auch den Text darunter - ohne diesen
 * Schritt verschmilzt alles zu einem einzigen Teil und es gibt nichts
 * mehr wegzuschneiden. Duenne Striche fallen aus dem Kern heraus, das
 * Gebaeude bleibt.
 */
function core(img) {
  const { width: w, height: h, data } = img;
  const solid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] < 24) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (data[(ny * w + nx) * 4 + 3] >= 24) n++;
        }
      }
      if (n >= 7) solid[i] = 1;
    }
  }
  return solid;
}

/** Deckende Pixel als Maske. */
function alphaMask(img) {
  const m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] >= 24 ? 1 : 0;
  return m;
}

function components(img, mask) {
  const { width: w, height: h } = img;
  const data = mask;
  const label = new Int32Array(w * h).fill(-1);
  const list = [];
  const stack = [];

  for (let start = 0; start < w * h; start++) {
    if (!data[start] || label[start] >= 0) continue;
    const id = list.length;
    label[start] = id;
    stack.push(start);
    let n = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;

    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      // 8er-Nachbarschaft: duenne diagonale Striche sollen als EIN Teil
      // gelten, sonst zerfaellt Text in hunderte Schnipsel.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (label[j] >= 0 || !data[j]) continue;
          label[j] = id;
          stack.push(j);
        }
      }
    }
    list.push({ id, n, x0, y0, x1, y1 });
  }
  return { label, list };
}

const gap = (a, b) => {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1));
  return Math.max(dx, dy);
};

export function trim(buf, pad = 1) {
  const img = decodePng(buf);
  const solid = core(img);
  const { label, list } = components(img, solid);
  if (list.length === 0) return buf;

  const main = list.reduce((a, b) => (b.n > a.n ? b : a));
  const keep = new Set([main.id]);
  for (const c of list) {
    if (c.id === main.id) continue;
    if (c.n >= main.n * KEEP_RATIO && gap(c, main) <= NEAR) keep.add(c.id);
  }

  // Vom Kern zurueck auf die vollen Pixel: alle deckenden Teile, die
  // einen behaltenen Kern beruehren. Ohne das blieben die Schnipsel des
  // gestrichelten Rahmens als Sprenkel im Bild stehen - sie liegen zwar
  // in der Box, gehoeren aber zu nichts.
  const full = components(img, alphaMask(img));
  const keepFull = new Set();
  for (const c of full.list) {
    for (let y = c.y0; y <= c.y1 && !keepFull.has(c.id); y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const i = y * img.width + x;
        if (full.label[i] === c.id && keep.has(label[i])) {
          keepFull.add(c.id);
          break;
        }
      }
    }
  }

  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (const c of full.list) {
    if (!keepFull.has(c.id)) continue;
    if (c.x0 < x0) x0 = c.x0;
    if (c.y0 < y0) y0 = c.y0;
    if (c.x1 > x1) x1 = c.x1;
    if (c.y1 > y1) y1 = c.y1;
  }
  if (x1 < 0) return buf;

  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(img.width - 1, x1 + pad);
  y1 = Math.min(img.height - 1, y1 + pad);

  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((y0 + y) * img.width + (x0 + x)) * 4;
      if (!keepFull.has(full.label[(y0 + y) * img.width + (x0 + x)])) continue;
      const dst = (y * w + x) * 4;
      out[dst] = img.data[src];
      out[dst + 1] = img.data[src + 1];
      out[dst + 2] = img.data[src + 2];
      out[dst + 3] = img.data[src + 3];
    }
  }
  return { png: encodePng(w, h, out), width: w, height: h, before: [img.width, img.height] };
}

// --- CLI ---------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length >= 2) {
  const [src, dst] = args;
  const padIdx = args.indexOf('--pad');
  const pad = padIdx >= 0 ? Number(args[padIdx + 1]) : 1;
  const files = statSync(src).isDirectory()
    ? readdirSync(src, { recursive: true }).filter((f) => String(f).endsWith('.png'))
    : [null];

  for (const rel of files) {
    const from = rel === null ? src : join(src, String(rel));
    const to = rel === null ? dst : join(dst, String(rel));
    const r = trim(readFileSync(from), pad);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, r.png ?? r);
    if (r.png) {
      console.log(`${basename(from).padEnd(26)} ${r.before[0]}x${r.before[1]} -> ${r.width}x${r.height}`);
    }
  }
}
