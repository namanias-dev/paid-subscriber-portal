#!/usr/bin/env node
/**
 * Recover a true-alpha product cutout from the attached notebook PNG.
 * The source is RGB with a baked Photoshop-style checkerboard (no alpha).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SRC =
  process.argv[2] ||
  "/home/ubuntu/.cursor/projects/workspace/assets/de9e5a81-d389-43fc-9ea6-1a1d07d79475.png";
const OUT_DIR = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), "../../public/notes");

function detectTile(data, w, h, channels) {
  const scores = [];
  for (const tile of [8, 10, 12, 16, 20, 24]) {
    let err = 0;
    let n = 0;
    for (let y = 0; y < Math.min(h, 120); y++) {
      for (let x = 0; x < Math.min(w, 120); x++) {
        const i = (y * w + x) * channels;
        const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const cell = ((Math.floor(x / tile) + Math.floor(y / tile)) & 1) === 0;
        const expect = cell ? 193 : 128;
        err += Math.abs(v - expect);
        n += 1;
      }
    }
    scores.push({ tile, err: err / n });
  }
  scores.sort((a, b) => a.err - b.err);
  return scores[0].tile;
}

function checkerMeans(data, w, h, channels, tile) {
  let light = 0;
  let dark = 0;
  let ln = 0;
  let dn = 0;
  for (let y = 0; y < Math.min(h, 80); y++) {
    for (let x = 0; x < Math.min(w, 80); x++) {
      const i = (y * w + x) * channels;
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const chroma = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      if (chroma > 18) continue;
      if (((Math.floor(x / tile) + Math.floor(y / tile)) & 1) === 0) {
        light += v;
        ln += 1;
      } else {
        dark += v;
        dn += 1;
      }
    }
  }
  return { light: ln ? light / ln : 193, dark: dn ? dark / dn : 128 };
}

async function main() {
  const img = sharp(SRC);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const tile = detectTile(data, w, h, c);
  const means = checkerMeans(data, w, h, c, tile);
  const alpha = Buffer.alloc(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * c;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const v = (r + g + b) / 3;
      const cell = ((Math.floor(x / tile) + Math.floor(y / tile)) & 1) === 0;
      const expect = cell ? means.light : means.dark;
      const checkerDist = Math.abs(v - expect);
      const nearChecker =
        chroma < 22 &&
        checkerDist < 28 &&
        v < 220 &&
        v > 90 &&
        Math.abs(r - g) < 16 &&
        Math.abs(g - b) < 16;

      // Product: paper whites, navy ink, spiral blacks, line-art trees.
      const isPaper = v > 228 && chroma < 28;
      const isInk = (b > r + 12 && v < 90) || (v < 48 && chroma < 30);
      const isLine = chroma < 20 && v < 80;

      let a = 255;
      if (nearChecker && !isPaper && !isInk && !isLine) a = 0;
      else if (nearChecker && isPaper) a = 220;
      else if (checkerDist < 14 && chroma < 14 && v < 210) a = 0;
      alpha[y * w + x] = a;
    }
  }

  // Flood-fill background from the border so interior paper stays opaque.
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (seen[idx]) return;
    seen[idx] = 1;
    stack.push(idx);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  const bg = new Uint8Array(w * h);
  while (stack.length) {
    const idx = stack.pop();
    if (alpha[idx] > 40) continue;
    bg[idx] = 1;
    const x = idx % w;
    const y = (idx - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  for (let i = 0; i < alpha.length; i++) {
    if (bg[i]) alpha[i] = 0;
    else if (alpha[i] < 180) alpha[i] = 255;
  }

  // Feather the silhouette.
  const feathered = Buffer.from(alpha);
  const radius = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (alpha[idx] === 255) {
        let min = 255;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) {
              min = 0;
              continue;
            }
            min = Math.min(min, alpha[yy * w + xx]);
          }
        }
        if (min === 0) feathered[idx] = 210;
      }
    }
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = data[i * c];
    rgba[i * 4 + 1] = data[i * c + 1];
    rgba[i * 4 + 2] = data[i * c + 2];
    rgba[i * 4 + 3] = feathered[i];
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const fullPng = join(OUT_DIR, "hero-notebook-full.png");
  await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(fullPng);
  await sharp(fullPng)
    .resize({ width: 900, withoutEnlargement: true })
    .webp({ quality: 88, alphaQuality: 90 })
    .toFile(join(OUT_DIR, "hero-notebook.webp"));
  await sharp(fullPng)
    .resize({ width: 560, withoutEnlargement: true })
    .webp({ quality: 84, alphaQuality: 88 })
    .toFile(join(OUT_DIR, "hero-notebook-sm.webp"));
  await sharp(fullPng)
    .resize({ width: 900, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT_DIR, "hero-notebook.png"));

  const meta = await sharp(join(OUT_DIR, "hero-notebook.png")).metadata();
  writeFileSync(
    join(OUT_DIR, "hero-notebook.json"),
    JSON.stringify(
      {
        tile,
        means,
        width: meta.width,
        height: meta.height,
        hasAlpha: meta.hasAlpha,
      },
      null,
      2,
    ),
  );
  console.log("wrote", OUT_DIR, { tile, means, width: meta.width, height: meta.height, hasAlpha: meta.hasAlpha });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
