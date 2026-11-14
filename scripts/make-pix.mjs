// Prints the Pix "copia e cola" payload and writes icons/pix-qr.png. The payload logic lives in
// content/core.js (shared with the popup and sidebar). The QR library is only needed here, never
// shipped: npm install qrcode in a folder outside the repo and point QRCODE_DIR at it.
// Run: QRCODE_DIR=/path/to/folder node scripts/make-pix.mjs
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../content/core.js';

const { crc16, pixPayload } = globalThis.ZP.core;
assert.strictEqual(crc16('123456789'), 0x29b1); // CRC16-CCITT-FALSE check value
const payload = pixPayload();
assert.strictEqual(crc16(payload.slice(0, -4)).toString(16).toUpperCase().padStart(4, '0'), payload.slice(-4));
console.log(payload);

let QRCode;
try {
  QRCode = createRequire(join(process.env.QRCODE_DIR || process.cwd(), 'x.js'))('qrcode');
} catch {
  console.warn('qrcode not found (set QRCODE_DIR): skipped icons/pix-qr.png');
  process.exit(0);
}
const out = fileURLToPath(new URL('../icons/pix-qr.png', import.meta.url));
await QRCode.toFile(out, payload, { errorCorrectionLevel: 'M', margin: 4, width: 640, color: { dark: '#000000', light: '#ffffff' } });
console.log('wrote icons/pix-qr.png');
