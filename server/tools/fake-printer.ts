// A pretend LAN thermal printer: listens like a real one on TCP (default 9100) and saves every
// ticket it receives as a PNG, so printing can be tested without hardware.
//   npm run fake-printer -w server -- 9100 9101 9102
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEscpos } from '../src/print/escpos.ts';
import { bitmapToPng } from '../src/print/render.ts';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'fake-printer');
fs.mkdirSync(outDir, { recursive: true });
const ports = process.argv.slice(2).map(Number).filter(Boolean);
let seq = 0;

for (const port of ports.length ? ports : [9100]) {
  net
    .createServer((sock) => {
      const chunks: Buffer[] = [];
      sock.on('data', (d) => chunks.push(d));
      sock.on('end', () => {
        const buf = Buffer.concat(chunks);
        const { bitmap, cuts, jobs } = decodeEscpos(buf);
        if (!bitmap.height) return console.log(`[${port}] connection check (no data)`);
        const file = path.join(outDir, `${port}-${String(++seq).padStart(3, '0')}.png`);
        fs.writeFileSync(file, bitmapToPng(bitmap));
        console.log(`[${port}] received ${buf.length} bytes · ${jobs} copy · ${bitmap.width}x${bitmap.height}px · cut ${cuts} → ${file}`);
      });
      sock.on('error', () => {});
    })
    .listen(port, () => console.log(`fake printer listening on ${port} → ${outDir}`));
}
