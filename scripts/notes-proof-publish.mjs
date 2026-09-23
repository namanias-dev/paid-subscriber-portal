#!/usr/bin/env node
/**
 * Publish the Anti-Defection sample pages and the physical-notes proof video
 * to the public `media/` prefix. The source PDF is already watermarked.
 * Pages are screen-sized WebP derivatives — not a second watermark pass.
 *
 *   node scripts/notes-proof-publish.mjs --pdf <file> [--video-key notes-reels/IMG_7595_CURSOR_UPLOAD.mp4]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const pdfPath = flag("pdf");
const videoKey = flag("video-key", "notes-reels/IMG_7595_CURSOR_UPLOAD.mp4");
if (!pdfPath) {
  console.error("Missing --pdf");
  process.exit(1);
}

const outDir = "/tmp/notes-proof";
mkdirSync(outDir, { recursive: true });

function run(bin, argv) {
  const out = spawnSync(bin, argv, { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`${bin} failed: ${out.stderr || out.stdout}`);
  return out.stdout;
}

const account = (process.env.CLOUDFLARE_R2_ACCOUNT_ID || "").trim();
const endpoint = (process.env.CLOUDFLARE_R2_ENDPOINT || (account ? `https://${account}.r2.cloudflarestorage.com` : "")).replace(/\/+$/, "");
const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const client = new S3Client({
  region: "auto",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: (process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: (process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "").trim(),
  },
});

async function put(file, key, type) {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: readFileSync(file),
    ContentType: type,
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return key;
}

const mupdf = await import("mupdf");
const pdf = readFileSync(pdfPath);
const doc = mupdf.Document.openDocument(pdf, "application/pdf");
const count = doc.countPages();
const pages = [];
for (let i = 0; i < count; i += 1) {
  const page = doc.loadPage(i);
  const pix = page.toPixmap(mupdf.Matrix.scale(160 / 72, 160 / 72), mupdf.ColorSpace.DeviceRGB, false);
  const png = Buffer.from(pix.asPNG());
  const webp = await sharp(png)
    .resize({ width: 1200, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 74, effort: 4 })
    .toBuffer();
  const name = `page-${String(i + 1).padStart(2, "0")}.webp`;
  const file = join(outDir, name);
  writeFileSync(file, webp);
  const meta = await sharp(webp).metadata();
  pages.push({ file, name, bytes: webp.length, width: meta.width, height: meta.height });
  pix.destroy?.();
  page.destroy?.();
  process.stdout.write(`page ${i + 1}/${count} ${webp.length}\n`);
}

const videoFile = join(outDir, "source.mp4");
const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: videoKey }));
const chunks = [];
for await (const chunk of obj.Body) chunks.push(chunk);
writeFileSync(videoFile, Buffer.concat(chunks));
const probe = JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", videoFile]));
const video = (probe.streams || []).find((s) => s.codec_type === "video");
const poster = join(outDir, "poster.webp");
const full = join(outDir, "full.mp4");
const width = Number(video.width);
const height = Number(video.height);
const targetW = height > width ? Math.min(width, 720) : Math.min(width, 1280);
const scale = `${targetW}:-2`;
run("ffmpeg", ["-y", "-ss", "1.2", "-i", videoFile, "-frames:v", "1", "-vf", `scale=${scale}:flags=lanczos`, poster]);
const audioArgs = (probe.streams || []).some((s) => s.codec_type === "audio")
  ? ["-c:a", "aac", "-b:a", "96k", "-ac", "2"]
  : ["-an"];
run("ffmpeg", [
  "-y", "-i", videoFile,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high",
  "-preset", "veryfast", "-crf", "23",
  "-vf", `scale=${scale}:flags=lanczos,fps=30`,
  "-g", "60", "-keyint_min", "60",
  ...audioArgs,
  "-movflags", "+faststart",
  full,
]);
const encoded = JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", full]));
const encodedVideo = (encoded.streams || []).find((s) => s.codec_type === "video") || video;

const uploadedPages = [];
for (const page of pages) {
  uploadedPages.push(await put(page.file, `media/store/samples/anti-defection-law/${page.name}`, "image/webp"));
}
const uploadedPoster = await put(poster, "media/store/videos/physical-notes/poster.webp", "image/webp");
const uploadedFull = await put(full, "media/store/videos/physical-notes/full.mp4", "video/mp4");

const report = {
  pages: pages.map((p) => ({ name: p.name, bytes: p.bytes, width: p.width, height: p.height })),
  video: {
    sourceBytes: statSync(videoFile).size,
    codec: encodedVideo.codec_name,
    width: Number(encodedVideo.width),
    height: Number(encodedVideo.height),
    duration: Number(encoded.format?.duration || probe.format?.duration || 0),
    fullBytes: statSync(full).size,
  },
  uploadedPages,
  uploadedPoster,
  uploadedFull,
};
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ pageCount: count, video: report.video, uploadedFull, uploadedPoster }, null, 2));
