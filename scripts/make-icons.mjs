// Generates icons/icon{16,32,48,128}.png and store/promo-440x280.png with no dependencies.
// Run: node scripts/make-icons.mjs
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const BG = [11, 13, 16];
const ACCENT = [200, 245, 66];
const SS = 4; // supersampling per axis

function png(width, height, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shapes in unit coordinates (0..1) of the logo box.
const inRoundRect = (x, y, r) => {
  const dx = Math.max(r - x, x - (1 - r), 0);
  const dy = Math.max(r - y, y - (1 - r), 0);
  return dx * dx + dy * dy <= r * r;
};
const TRI = [[0.36, 0.25], [0.36, 0.75], [0.78, 0.5]];
const inTriangle = (x, y) => {
  const side = (a, b) => (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
  const d = [side(TRI[0], TRI[1]), side(TRI[1], TRI[2]), side(TRI[2], TRI[0])];
  return !(d.some((v) => v < 0) && d.some((v) => v > 0));
};

// Logo: accent rounded square with a dark play triangle. Returns [r, g, b, a] or null (outside).
function logo(u, v) {
  if (!inRoundRect(u, v, 0.24)) return null;
  return inTriangle(u, v) ? BG : ACCENT;
}

function render(width, height, sample) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          if (!c) continue;
          const alpha = c[3] ?? 1;
          r += c[0] * alpha; g += c[1] * alpha; b += c[2] * alpha; a += alpha;
        }
      }
      const i = (y * width + x) * 4;
      if (a > 0) out.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / (SS * SS)) * 255)], i);
    }
  }
  return png(width, height, out);
}

mkdirSync(new URL('icons/', root), { recursive: true });
mkdirSync(new URL('store/', root), { recursive: true });

for (const size of [16, 32, 48, 128]) {
  // 128px store icons should keep ~1/8 transparent padding; small sizes use the full box.
  const pad = size === 128 ? 16 : 0;
  const box = size - pad * 2;
  writeFileSync(new URL(`icons/icon${size}.png`, root), render(size, size, (x, y) => logo((x - pad) / box, (y - pad) / box)));
}

// Promo tile: dark background, soft accent glow, centered logo.
const W = 440, H = 280, L = 112;
writeFileSync(new URL('store/promo-440x280.png', root), render(W, H, (x, y) => {
  const mark = logo((x - (W - L) / 2) / L, (y - (H - L) / 2) / L);
  if (mark) return mark;
  const glow = Math.max(0, 1 - Math.hypot(x - W / 2, y - H / 2) / 230) ** 2 * 0.22;
  return BG.map((c, i) => c + (ACCENT[i] - c) * glow);
}));
console.log('icons written');
