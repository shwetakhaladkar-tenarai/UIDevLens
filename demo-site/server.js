/**
 * demo-site/server.js
 * Zero-dependency static + API server for the intentionally-flawed demo site.
 *
 * Serves:
 *   /                 index.html
 *   /styles.css /app.js /unused.js   static assets
 *   /big-image.png    a large, unoptimized PNG generated on the fly
 *   /api/products     fast JSON (fetched multiple times by app.js -> duplicate)
 *   /api/slow         intentionally slow (~2.5s) JSON response
 *
 * Run:  node server.js   (defaults to port 4173)
 */
import http from "http";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import zlib from "zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.DEMO_PORT || "4173", 10);

const STATIC = {
  "/":            { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html":  { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css":  { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js":      { file: "app.js",     type: "text/javascript; charset=utf-8" },
  "/unused.js":   { file: "unused.js",  type: "text/javascript; charset=utf-8" },
};

/** Build a large, deliberately unoptimized PNG (~solid image, big dimensions). */
function makeBigPng() {
  // 1600x1200 truecolor PNG, uncompressed-ish (zlib level 0) -> large file.
  const width = 1600, height = 1200;
  const bytesPerPixel = 3;
  const rowSize = width * bytesPerPixel + 1; // +1 filter byte per row
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const off = y * rowSize;
    raw[off] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * bytesPerPixel;
      raw[p] = (x * 255 / width) | 0;      // R gradient
      raw[p + 1] = (y * 255 / height) | 0; // G gradient
      raw[p + 2] = 128;                    // B constant
    }
  }
  const idat = zlib.deflateSync(raw, { level: 0 }); // level 0 => big

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type 2 = truecolor
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// Minimal CRC32 for PNG chunks.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

let BIG_PNG = null;

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  // ── Static assets ──
  if (STATIC[url]) {
    try {
      const { file, type } = STATIC[url];
      const body = await readFile(path.join(__dirname, file));
      res.writeHead(200, { "content-type": type });
      return res.end(body);
    } catch {
      res.writeHead(500); return res.end("read error");
    }
  }

  // ── Oversized image (no compression header, big body) ──
  if (url === "/big-image.png") {
    if (!BIG_PNG) BIG_PNG = makeBigPng();
    res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
    return res.end(BIG_PNG);
  }

  // ── Fast product API (fetched multiple times => duplicate finding) ──
  if (url === "/api/products") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ products: [{ id: 1, name: "Widget" }, { id: 2, name: "Gadget" }] }));
  }

  // ── Intentionally slow API (~2.5s) ──
  if (url === "/api/slow") {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, note: "slow response" }));
    }, 2500);
    return;
  }

  // ── BROKEN redirect: 302 to a route that doesn't exist -> 404 ──
  // Fixture for functional/links.py + navigation.py "broken redirect" detection.
  if (url === "/old-promo") {
    res.writeHead(302, { location: "/promo-page-that-does-not-exist" });
    return res.end();
  }

  // ── WORKING redirect (contrast case, proves no false positive) ──
  if (url === "/promo") {
    res.writeHead(301, { location: "/" });
    return res.end();
  }

  // Any other unmatched path (e.g. /this-page-does-not-exist,
  // /promo-page-that-does-not-exist) falls through to the 404 below —
  // used as the "broken internal link" fixture.
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`[demo-site] running at http://localhost:${PORT}`);
  console.log(`[demo-site] APIs: /api/products (duplicate), /api/slow (~2.5s), /big-image.png (oversized)`);
});
