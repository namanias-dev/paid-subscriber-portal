#!/usr/bin/env node
/**
 * Generates the watermark tile used to bake sample-page previews.
 *
 * Run locally and commit the output. It is deliberately NOT generated at
 * runtime: rendering SVG text needs librsvg to find a real font, and a serverless
 * image has no font guarantees — the failure mode there is a silent blank
 * watermark on an unprotected sample page, which is the one outcome that must not
 * be possible. A committed PNG tile removes the dependency entirely.
 *
 * Run: node scripts/store/build-watermark-tile.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dirname, "../..");
const OUT_DIR = join(ROOT, "assets/store");
const OUT = join(OUT_DIR, "sample-watermark-tile.png");

// One tile, rotated text, repeated across the page by sharp's tile composite.
// Low opacity: legible enough to deter reuse, light enough to read the notes.
const TILE = 300;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}">
  <g transform="rotate(-32 ${TILE / 2} ${TILE / 2})" fill="#0B1B3A" fill-opacity="0.13"
     font-family="Helvetica, Arial, sans-serif" text-anchor="middle">
    <text x="${TILE / 2}" y="${TILE / 2 - 8}" font-size="26" font-weight="700" letter-spacing="2">NAMAN IAS</text>
    <text x="${TILE / 2}" y="${TILE / 2 + 16}" font-size="14" font-weight="600" letter-spacing="4">SAMPLE COPY</text>
    <text x="${TILE / 2}" y="${TILE / 2 + 36}" font-size="11" font-weight="500" letter-spacing="1">namanias.com</text>
  </g>
</svg>`;

mkdirSync(OUT_DIR, { recursive: true });
const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(OUT, png);

const meta = await sharp(png).metadata();
console.log(`wrote ${OUT} — ${meta.width}x${meta.height}, ${png.length} bytes`);
