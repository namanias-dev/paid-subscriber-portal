#!/usr/bin/env node
/**
 * Encode Notes Store teaching-video derivatives, then optionally upload them
 * to the existing Cloudflare R2 `media/store/videos/<id>/` prefix.
 *
 * Usage:
 *   node scripts/notes-teaching-encode.mjs --id naman-sir-teaches-01 --src /path/to/master.mp4
 *   node scripts/notes-teaching-encode.mjs --id naman-sir-teaches-01 --src /path/to/master.mp4 --upload
 *
 * Never commits masters. Never prints secrets.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const args = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const id = flag("id", "naman-sir-teaches-01");
const src = flag("src");
const posterAt = flag("poster-at", "2.4");
const previewStart = flag("preview-start", "0");
const previewSeconds = flag("preview-seconds", "12");
const upload = args.includes("--upload");

if (!src) {
  console.error("Usage: node scripts/notes-teaching-encode.mjs --id <id> --src <master> [--upload]");
  process.exit(1);
}

function run(bin, argv) {
  const out = spawnSync(bin, argv, { encoding: "utf8" });
  if (out.status !== 0) {
    throw new Error(`${bin} failed: ${out.stderr || out.stdout}`);
  }
  return out.stdout;
}

const probe = JSON.parse(run("ffprobe", [
  "-v", "error",
  "-print_format", "json",
  "-show_streams",
  "-show_format",
  src,
]));
const video = (probe.streams || []).find((s) => s.codec_type === "video");
const audio = (probe.streams || []).find((s) => s.codec_type === "audio");
if (!video) throw new Error("No video stream");

const width = Number(video.width);
const height = Number(video.height);
const outDir = join("/tmp/notes-teaching", id);
mkdirSync(outDir, { recursive: true });
const poster = join(outDir, "poster.webp");
const preview = join(outDir, "preview.mp4");
const full = join(outDir, "full.mp4");

run("ffmpeg", [
  "-y", "-ss", posterAt, "-i", src, "-frames:v", "1",
  "-vf", `scale=${width}:${height}:flags=lanczos`,
  poster,
]);
run("ffmpeg", [
  "-y", "-ss", previewStart, "-t", previewSeconds, "-i", src,
  "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
  "-preset", "slow", "-crf", "23",
  "-vf", `scale=${width}:${height}:flags=lanczos`,
  "-movflags", "+faststart",
  preview,
]);
run("ffmpeg", [
  "-y", "-i", src,
  "-c:v", "libx264", "-pix_fmt", "yuv420p",
  "-preset", "slow", "-crf", "23",
  "-vf", `scale=${width}:${height}:flags=lanczos`,
  "-c:a", "aac", "-b:a", "96k", "-ac", "1",
  "-movflags", "+faststart",
  full,
]);

const report = {
  id,
  source: {
    file: basename(src),
    bytes: statSync(src).size,
    width,
    height,
    aspect: `${width}:${height}`,
    codec: video.codec_name,
    fps: video.avg_frame_rate,
    duration: Number(probe.format?.duration || 0),
    bitrate: Number(probe.format?.bit_rate || 0),
    audioCodec: audio?.codec_name || null,
  },
  derivatives: {
    poster: { file: poster, bytes: statSync(poster).size },
    preview: { file: preview, bytes: statSync(preview).size },
    full: { file: full, bytes: statSync(full).size },
  },
};

if (upload) {
  const account = (process.env.CLOUDFLARE_R2_ACCOUNT_ID || "").trim();
  const endpoint = (process.env.CLOUDFLARE_R2_ENDPOINT || (account ? `https://${account}.r2.cloudflarestorage.com` : "")).replace(/\/+$/, "");
  const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const accessKeyId = (process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "").trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 env missing — cannot upload");
  }
  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const put = async (file, key, type) => {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: readFileSync(file),
      ContentType: type,
      CacheControl: "public, max-age=31536000, immutable",
    }));
    return key;
  };
  report.uploaded = {
    poster: await put(poster, `media/store/videos/${id}/poster.webp`, "image/webp"),
    preview: await put(preview, `media/store/videos/${id}/preview.mp4`, "video/mp4"),
    full: await put(full, `media/store/videos/${id}/full.mp4`, "video/mp4"),
  };
}

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
