// ESC/POS raster encoding (GS v 0). Works on practically every 58/80mm thermal printer.
import type { Bitmap } from './render.ts';

const STRIP_ROWS = 128; // some printers choke on very tall single raster commands

export function encodeRaster(bm: Bitmap, opts: { cut: boolean; copies?: number }): Buffer {
  const bytesPerRow = bm.width / 8;
  const parts: Buffer[] = [];
  for (let copy = 0; copy < Math.max(1, opts.copies ?? 1); copy++) {
    parts.push(Buffer.from([0x1b, 0x40])); // ESC @  initialize
    for (let y0 = 0; y0 < bm.height; y0 += STRIP_ROWS) {
      const rows = Math.min(STRIP_ROWS, bm.height - y0);
      const out = Buffer.alloc(8 + rows * bytesPerRow);
      out.set([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8], 0); // GS v 0
      for (let r = 0; r < rows; r++) {
        for (let bx = 0; bx < bytesPerRow; bx++) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            if (bm.data[(y0 + r) * bm.width + bx * 8 + bit]) byte |= 0x80 >> bit;
          }
          out[8 + r * bytesPerRow + bx] = byte;
        }
      }
      parts.push(out);
    }
    parts.push(Buffer.from([0x1b, 0x64, 0x04])); // ESC d 4  feed 4 lines
    if (opts.cut) parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // GS V B 0  feed and partial cut
  }
  return Buffer.concat(parts);
}

/** Inverse of encodeRaster: stack all raster strips into one bitmap (tests and the fake printer). */
export function decodeEscpos(buf: Buffer): { bitmap: Bitmap; cuts: number; jobs: number } {
  const strips: { w: number; rows: number; data: Buffer }[] = [];
  let cuts = 0;
  let jobs = 0;
  let i = 0;
  while (i < buf.length) {
    if (buf[i] === 0x1b && buf[i + 1] === 0x40) {
      jobs++;
      i += 2;
    } else if (buf[i] === 0x1b && buf[i + 1] === 0x64) {
      i += 3;
    } else if (buf[i] === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
      const w = buf[i + 4] | (buf[i + 5] << 8);
      const rows = buf[i + 6] | (buf[i + 7] << 8);
      strips.push({ w, rows, data: buf.subarray(i + 8, i + 8 + w * rows) });
      i += 8 + w * rows;
    } else if (buf[i] === 0x1d && buf[i + 1] === 0x56) {
      cuts++;
      i += buf[i + 2] === 0x42 ? 4 : 3;
    } else {
      i++;
    }
  }
  const bytesPerRow = strips[0]?.w ?? 0;
  const height = strips.reduce((s, x) => s + x.rows, 0);
  const data = new Uint8Array(bytesPerRow * 8 * height);
  let y = 0;
  for (const s of strips) {
    for (let r = 0; r < s.rows; r++, y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        const byte = s.data[r * bytesPerRow + bx];
        for (let bit = 0; bit < 8; bit++) data[y * bytesPerRow * 8 + bx * 8 + bit] = byte & (0x80 >> bit) ? 1 : 0;
      }
    }
  }
  return { bitmap: { width: bytesPerRow * 8, height, data }, cuts, jobs };
}
