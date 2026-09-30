const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function writePng(size, outPath) {
  // Build raw RGBA scanlines (filter byte 0 per row)
  const rowSize = 1 + size * 4;
  const raw = Buffer.alloc(size * rowSize);

  for (let y = 0; y < size; y++) {
    raw[y * rowSize] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const i = y * rowSize + 1 + x * 4;
      // Indigo-900 gradient: top-left lighter, bottom-right darker
      const t = (x + y) / (size * 2);
      // from #312e81 to #0f172a
      raw[i]   = Math.round(0x31 + t * (0x0f - 0x31)); // R
      raw[i+1] = Math.round(0x2e + t * (0x17 - 0x2e)); // G
      raw[i+2] = Math.round(0x81 + t * (0x2a - 0x81)); // B
      raw[i+3] = 255;                                    // A
    }
  }

  // Add a simple star shape (white circle in the center-ish)
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);
  const starR = Math.floor(size * 0.28);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < starR * starR) {
        // Draw a bright star-yellow circle
        const i = y * rowSize + 1 + x * 4;
        // Distance from center for shading
        const dist = Math.sqrt(dx*dx + dy*dy) / starR;
        raw[i]   = Math.round(253 - dist * 30); // amber ~#fbbf24
        raw[i+1] = Math.round(191 - dist * 40);
        raw[i+2] = Math.round(36  - dist * 10);
        raw[i+3] = 255;
      }
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcb = Buffer.alloc(4); crcb.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crcb]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  fs.writeFileSync(outPath, png);
  console.log(`Written ${outPath} (${size}x${size}, ${png.length} bytes)`);
}

const iconDir = path.join(__dirname, 'frontend/public/icons');
if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir, { recursive: true });

writePng(192, path.join(iconDir, 'pwa-192.png'));
writePng(512, path.join(iconDir, 'pwa-512.png'));
console.log('PWA icons generated!');
