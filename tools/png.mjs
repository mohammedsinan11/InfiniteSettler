/**
 * Minimaler PNG-Decoder und -Encoder.
 *
 * Bewusst ohne Abhaengigkeiten: node:zlib bringt alles mit, was PNG
 * braucht, und das Projekt soll fuer ein Werkzeugskript keine
 * Bildbibliothek einziehen.
 *
 * Unterstuetzt Bittiefe 8, nicht interlaced, Farbtypen 0/2/3/4/6.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** @returns {{width:number,height:number,data:Uint8Array}} RGBA, 8 Bit */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('kein PNG');

  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      ihdr = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'tRNS') trns = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
  }

  if (!ihdr) throw new Error('IHDR fehlt');
  if (ihdr.depth !== 8) throw new Error(`Bittiefe ${ihdr.depth} nicht unterstuetzt`);
  if (ihdr.interlace !== 0) throw new Error('interlaced PNG nicht unterstuetzt');

  const { width: w, height: h, colorType: ct } = ihdr;
  const ch = CHANNELS[ct];
  if (!ch) throw new Error(`Farbtyp ${ct} nicht unterstuetzt`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;

  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    unfilter(filter, line, prev, ch, stride);
    line.copy(out, y * stride);
    prev = line;
  }

  // -> RGBA
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const d = i * 4;
    if (ct === 6) {
      data[d] = out[i * 4]; data[d + 1] = out[i * 4 + 1];
      data[d + 2] = out[i * 4 + 2]; data[d + 3] = out[i * 4 + 3];
    } else if (ct === 2) {
      data[d] = out[i * 3]; data[d + 1] = out[i * 3 + 1];
      data[d + 2] = out[i * 3 + 2]; data[d + 3] = 255;
    } else if (ct === 3) {
      const idx = out[i];
      data[d] = palette[idx * 3]; data[d + 1] = palette[idx * 3 + 1];
      data[d + 2] = palette[idx * 3 + 2];
      data[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
    } else if (ct === 0) {
      data[d] = data[d + 1] = data[d + 2] = out[i];
      data[d + 3] = 255;
    } else {
      data[d] = data[d + 1] = data[d + 2] = out[i * 2];
      data[d + 3] = out[i * 2 + 1];
    }
  }

  return { width: w, height: h, data };
}

function unfilter(type, line, prev, ch, stride) {
  switch (type) {
    case 0:
      return;
    case 1:
      for (let x = ch; x < stride; x++) line[x] = (line[x] + line[x - ch]) & 255;
      return;
    case 2:
      for (let x = 0; x < stride; x++) line[x] = (line[x] + prev[x]) & 255;
      return;
    case 3:
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? line[x - ch] : 0;
        line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255;
      }
      return;
    case 4:
      for (let x = 0; x < stride; x++) {
        const a = x >= ch ? line[x - ch] : 0;
        const b = prev[x];
        const c = x >= ch ? prev[x - ch] : 0;
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[x] = (line[x] + pred) & 255;
      }
      return;
    default:
      throw new Error(`Filtertyp ${type} unbekannt`);
  }
}

/** RGBA -> PNG (Farbtyp 6). */
export function encodePng(width, height, data) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // Filter "none"
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([len, typed, crc]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return c ^ -1;
}
