import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createCRC32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}

const crcTable = createCRC32Table();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

function generateIconPNG(size) {
  // Create raw RGBA scanlines
  // Each scanline starts with filter byte 0
  const scanlineWidth = 1 + size * 4;
  const rawData = Buffer.alloc(size * scanlineWidth);

  for (let y = 0; y < size; y++) {
    const rowOffset = y * scanlineWidth;
    rawData[rowOffset] = 0; // Filter type: None

    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Distance from center for rounded circle/box
      const cx = size / 2;
      const cy = size / 2;
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const radius = size * 0.44;

      // Corner radius test
      const cornerRadius = size * 0.2;
      const inBox = (dx <= cx - cornerRadius && dy <= cy) ||
                    (dy <= cy - cornerRadius && dx <= cx) ||
                    (Math.hypot(dx - (cx - cornerRadius), dy - (cy - cornerRadius)) <= cornerRadius);

      if (inBox) {
        // Vibrant Indigo to Violet diagonal gradient (#6366f1 to #a855f7)
        const t = (x + y) / (size * 2);
        const r = Math.round(99 * (1 - t) + 168 * t);
        const g = Math.round(102 * (1 - t) + 85 * t);
        const b = Math.round(241 * (1 - t) + 247 * t);

        // Center symbol check (a stylized 'T' and 'M' check or sparkle)
        const isCenterSymbol = (Math.abs(x - cx) < size * 0.22 && Math.abs(y - cy) < size * 0.08) ||
                               (Math.abs(x - cx) < size * 0.07 && dy < size * 0.25 && y >= cy - size * 0.08);

        if (isCenterSymbol) {
          rawData[pxOffset] = 255;
          rawData[pxOffset + 1] = 255;
          rawData[pxOffset + 2] = 255;
          rawData[pxOffset + 3] = 255;
        } else {
          rawData[pxOffset] = r;
          rawData[pxOffset + 1] = g;
          rawData[pxOffset + 2] = b;
          rawData[pxOffset + 3] = 255;
        }
      } else {
        // Transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  // Deflate IDAT
  const compressed = zlib.deflateSync(rawData);

  // PNG Header
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // IDAT chunk
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.resolve('icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

[16, 48, 128].forEach(size => {
  const png = generateIconPNG(size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Generated icon${size}.png (${png.length} bytes)`);
});
