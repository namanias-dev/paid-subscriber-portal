#!/usr/bin/env node
/**
 * Recover a true-alpha product cutout from the attached notebook PNG.
 * The source is RGB with a baked Photoshop-style checkerboard (no alpha).
 */
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SRC =
  process.argv[2] ||
  "/home/ubuntu/.cursor/projects/workspace/assets/de9e5a81-d389-43fc-9ea6-1a1d07d79475.png";
const OUT_DIR = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), "../../public/notes");

function isBackground(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const chroma = mx - mn;
  const l = (r + g + b) / 3;
  if (chroma > 26) return false;
  if (l > 234) return false;
  if (l < 48) return false;
  return l >= 90 && l <= 220 && chroma < 20;
}

function isProduct(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const chroma = mx - mn;
  const l = (r + g + b) / 3;
  if (l > 234 && chroma < 30) return true;
  if (l < 52) return true;
  if (b > r + 10 && l < 120) return true;
  return false;
}

async function main() {
  const img = sharp(SRC);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const bg = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const stack = [];

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (seen[idx]) return;
    const i = idx * c;
    if (!isBackground(data[i], data[i + 1], data[i + 2])) return;
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

  while (stack.length) {
    const idx = stack.pop();
    bg[idx] = 1;
    const x = idx % w;
    const y = (idx - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  const alpha = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * c;
    if (bg[i]) alpha[i] = 0;
    else if (isProduct(data[p], data[p + 1], data[p + 2])) alpha[i] = 255;
    else alpha[i] = 255;
  }

  // Contract one pixel of leftover checker fringe, then feather.
  const contracted = Buffer.from(alpha);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (alpha[idx] === 0) continue;
      let bgN = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (alpha[(y + dy) * w + (x + dx)] === 0) bgN += 1;
        }
      }
      const p = idx * c;
      if (bgN >= 3 && isBackground(data[p], data[p + 1], data[p + 2])) contracted[idx] = 0;
    }
  }

  const feathered = Buffer.from(contracted);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (contracted[idx] === 0) continue;
      let min = 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) min = Math.min(min, contracted[(y + dy) * w + (x + dx)]);
      }
      if (min === 0) feathered[idx] = 180;
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
    .webp({ quality: 88, alphaQuality: 92 })
    .toFile(join(OUT_DIR, "hero-notebook.webp"));
  await sharp(fullPng)
    .resize({ width: 560, withoutEnlargement: true })
    .webp({ quality: 84, alphaQuality: 90 })
    .toFile(join(OUT_DIR, "hero-notebook-sm.webp"));
  await sharp(fullPng)
    .resize({ width: 900, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 88, effort: 10 })
    .toFile(join(OUT_DIR, "hero-notebook.png"));

  await sharp(join(OUT_DIR, "hero-notebook.webp"))
    .flatten({ background: { r: 247, g: 245, b: 241 } })
    .png()
    .toFile(join(OUT_DIR, "hero-notebook-ivory-preview.png"));

  unlinkSync(fullPng);
  const meta = await sharp(join(OUT_DIR, "hero-notebook.webp")).metadata();
  console.log("wrote", OUT_DIR, { width: meta.width, height: meta.height, hasAlpha: meta.hasAlpha });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
