// Draws a ticket (list of blocks) into a 1-bit bitmap. Thermal printers have no Lao font,
// so tickets are rendered as images with Noto Sans Lao + Inter and sent as raster data.
import canvasPkg from '@napi-rs/canvas';
import { createRequire } from 'node:module';

const { createCanvas, GlobalFonts } = canvasPkg;
const require = createRequire(import.meta.url);

export type Size = 's' | 'm' | 'l' | 'xl';
export type Block =
  | { t: 'text'; text: string; size?: Size; bold?: boolean; align?: 'left' | 'center' | 'right' }
  | { t: 'row'; left: string; right: string; size?: Size; bold?: boolean; indent?: number }
  | { t: 'rule'; style?: 'dash' | 'solid' }
  | { t: 'space'; h?: number };

/** One byte per pixel, 1 = black. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

const PX: Record<Size, number> = { s: 22, m: 26, l: 34, xl: 46 };
const MARGIN = 6;

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  const dir = (pkg: string) => require.resolve(`${pkg}/package.json`).replace('package.json', 'files/');
  const lao = dir('@fontsource/noto-sans-lao');
  const inter = dir('@fontsource/inter');
  GlobalFonts.registerFromPath(lao + 'noto-sans-lao-lao-400-normal.woff', 'LazaLao');
  GlobalFonts.registerFromPath(lao + 'noto-sans-lao-lao-700-normal.woff', 'LazaLaoBold');
  GlobalFonts.registerFromPath(inter + 'inter-latin-400-normal.woff', 'LazaSans');
  GlobalFonts.registerFromPath(inter + 'inter-latin-ext-400-normal.woff', 'LazaSansExt');
  GlobalFonts.registerFromPath(inter + 'inter-latin-700-normal.woff', 'LazaSansBold');
  GlobalFonts.registerFromPath(inter + 'inter-latin-ext-700-normal.woff', 'LazaSansBoldExt');
  fontsReady = true;
}

const fontOf = (size: Size, bold?: boolean) =>
  `${PX[size]}px ${bold ? 'LazaLaoBold, LazaSansBold, LazaSansBoldExt' : 'LazaLao, LazaSans, LazaSansExt'}`;

type Ctx = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

const segmenter = new Intl.Segmenter('lo', { granularity: 'grapheme' });
const graphemes = (s: string) => [...segmenter.segment(s)].map((x) => x.segment);

/** Wrap text to a pixel width. Lao has no spaces between words, so over-long words break on grapheme boundaries. */
function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const tok of para.split(/(?<=\s)/)) {
      if (ctx.measureText((line + tok).trimEnd()).width <= maxW) {
        line += tok;
        continue;
      }
      if (line) {
        out.push(line.trimEnd());
        line = '';
      }
      if (ctx.measureText(tok.trimEnd()).width <= maxW) {
        line = tok;
        continue;
      }
      for (const g of graphemes(tok)) {
        if (ctx.measureText(line + g).width <= maxW) line += g;
        else {
          if (line) out.push(line);
          line = g;
        }
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Lay blocks out top to bottom. With draw=false it only measures. Returns total height. */
function layout(ctx: Ctx, blocks: Block[], width: number, draw: boolean): number {
  const inner = width - MARGIN * 2;
  let y = MARGIN;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  for (const b of blocks) {
    if (b.t === 'space') {
      y += b.h ?? 10;
    } else if (b.t === 'rule') {
      y += 6;
      if (draw) {
        ctx.lineWidth = 2;
        ctx.setLineDash(b.style === 'solid' ? [] : [8, 6]);
        ctx.beginPath();
        ctx.moveTo(MARGIN, y);
        ctx.lineTo(width - MARGIN, y);
        ctx.stroke();
      }
      y += 8;
    } else if (b.t === 'text') {
      const size = b.size ?? 'm';
      ctx.font = fontOf(size, b.bold);
      const lh = Math.round(PX[size] * 1.5);
      for (const line of wrap(ctx, b.text, inner)) {
        y += lh;
        if (draw) {
          const w = ctx.measureText(line).width;
          const x = b.align === 'center' ? (width - w) / 2 : b.align === 'right' ? width - MARGIN - w : MARGIN;
          ctx.fillText(line, x, y - Math.round(PX[size] * 0.4));
        }
      }
    } else {
      const size = b.size ?? 'm';
      ctx.font = fontOf(size, b.bold);
      const lh = Math.round(PX[size] * 1.5);
      const indent = b.indent ?? 0;
      const rightW = b.right ? ctx.measureText(b.right).width : 0;
      const leftMax = inner - indent - (rightW ? rightW + 14 : 0);
      const lines = wrap(ctx, b.left, Math.max(leftMax, 60));
      lines.forEach((line, i) => {
        y += lh;
        if (!draw) return;
        ctx.fillText(line, MARGIN + indent, y - Math.round(PX[size] * 0.4));
        if (i === 0 && b.right) ctx.fillText(b.right, width - MARGIN - rightW, y - Math.round(PX[size] * 0.4));
      });
    }
  }
  return y + MARGIN;
}

export function renderBlocks(blocks: Block[], width: number): Bitmap {
  registerFonts();
  if (width % 8 !== 0) throw new Error('width must be a multiple of 8');
  const scratch = createCanvas(width, 10).getContext('2d');
  const height = Math.max(layout(scratch, blocks, width, false), 16);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  layout(ctx, blocks, width, true);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const lum = rgba[i * 4] * 0.3 + rgba[i * 4 + 1] * 0.59 + rgba[i * 4 + 2] * 0.11;
    data[i] = lum < 150 ? 1 : 0;
  }
  return { width, height, data };
}

/** Bitmap → PNG (used by the fake printer tool and tests). */
export function bitmapToPng(bm: Bitmap): Buffer {
  const canvas = createCanvas(bm.width, bm.height);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(bm.width, bm.height);
  for (let i = 0; i < bm.data.length; i++) {
    const v = bm.data[i] ? 0 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toBuffer('image/png');
}
