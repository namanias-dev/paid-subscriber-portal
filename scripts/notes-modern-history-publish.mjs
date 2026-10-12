#!/usr/bin/env node
/**
 * Publish Modern History Notes Store assets to the existing Cloudflare R2
 * `media/` prefix. Never commits masters. Never prints secrets.
 *
 *   node scripts/notes-modern-history-publish.mjs \
 *     --pdf <sample.pdf> --cover <portrait> --thumb <card> \
 *     --video <IMG_8005_CURSOR_UPLOAD.mp4> [--video-key notes-reels/IMG_8005_CURSOR_UPLOAD.mp4]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const pdfPath = flag("pdf");
const coverPath = flag("cover");
const thumbPath = flag("thumb");
const videoPath = flag("video");
const videoKey = flag("video-key", "notes-reels/IMG_8005_CURSOR_UPLOAD.mp4");
const sampleId = "modern-history-sample";
const videoId = "physical-notes-modern-history";
const productId = "c3a1e7d4-2b90-4f11-9c6a-0d8f2a1b7e55";

if (!pdfPath && !coverPath && !thumbPath && !videoPath) {
  console.error("Provide at least one of --pdf --cover --thumb --video");
  process.exit(1);
}

const outDir = "/tmp/notes-modern-history";
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

const report = { pages: [], images: {}, video: null };

if (pdfPath) {
  const mupdf = await import("mupdf");
  const pdf = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const count = doc.countPages();
  await put(pdfPath, `media/store/samples/${sampleId}/sample.pdf`, "application/pdf");
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
    report.pages.push({ name, bytes: webp.length, width: meta.width, height: meta.height });
    await put(file, `media/store/samples/${sampleId}/${name}`, "image/webp");
    pix.destroy?.();
    page.destroy?.();
  }
}

async function publishImage(src, key, width, height) {
  const webp = await sharp(src)
    .rotate()
    .resize({ width, height, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  const file = join(outDir, basename(key));
  writeFileSync(file, webp);
  const meta = await sharp(webp).metadata();
  await put(file, key, "image/webp");
  return { key, bytes: webp.length, width: meta.width, height: meta.height };
}

if (coverPath) {
  report.images.cover = await publishImage(coverPath, `media/store/products/${productId}/cover.webp`, 1600, 2000);
}
if (thumbPath) {
  report.images.thumb = await publishImage(thumbPath, `media/store/products/${productId}/thumb.webp`, 1200, 1500);
}

if (videoPath || args.includes("--from-r2")) {
  const videoFile = videoPath || join(outDir, "source.mp4");
  if (!videoPath) {
    const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: videoKey }));
    const chunks = [];
    for await (const chunk of obj.Body) chunks.push(chunk);
    writeFileSync(videoFile, Buffer.concat(chunks));
  }
  if (videoPath) {
    await put(videoPath, videoKey, "video/mp4");
  }
  const probe = JSON.parse(run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", videoFile]));
  const stream = (probe.streams || []).find((s) => s.codec_type === "video");
  const poster = join(outDir, "poster.webp");
  const full = join(outDir, "full.mp4");
  const width = Number(stream.width);
  const height = Number(stream.height);
  const targetW = height > width ? Math.min(width, 720) : Math.min(width, 1280);
  const scale = `${targetW}:-2`;
  run("ffmpeg", ["-y", "-ss", "1.2", "-i", videoFile, "-frames:v", "1", "-vf", `scale=${scale}:flags=lanczos`, poster]);
  const audioArgs = (probe.streams || []).some((s) => s.codec_type === "audio")
    ? ["-c:a", "aac", "-b:a", "96k", "-ac", 2]
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
  const encodedVideo = (encoded.streams || []).find((s) => s.codec_type === "video") || stream;
  await put(poster, `media/store/videos/${videoId}/poster.webp`, "image/webp");
  await put(full, `media/store/videos/${videoId}/full.mp4`, "video/mp4");
  report.video = {
    sourceBytes: statSync(videoFile).size,
    codec: encodedVideo.codec_name,
    width: Number(encodedVideo.width),
    height: Number(encodedVideo.height),
    duration: Number(encoded.format?.duration || probe.format?.duration || 0),
    fullBytes: statSync(full).size,
  };
}

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  pageCount: report.pages.length,
  images: Object.keys(report.images),
  video: report.video,
}, null, 2));
