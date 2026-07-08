#!/usr/bin/env node
/**
 * Backfill Content/LMS file sizes from Cloudflare R2 (the source of truth).
 *
 * Reads ACTUAL object sizes from R2 (ListObjectsV2 — read-only, never mutates or
 * downloads file bytes) and populates the DB size columns wherever they are
 * currently NULL. Existing non-null sizes are never overwritten. Missing /
 * inaccessible objects are simply skipped (left NULL → the UI shows "—").
 *
 *   node scripts/backfill-content-sizes.mjs           # DRY-RUN (default)
 *   node scripts/backfill-content-sizes.mjs --apply    # write sizes to the DB
 *
 * Maps R2 keys → rows:
 *   processed/<course>/<recId>/lecture.mp4       -> content_items.file_size
 *   processed/webinars/<webinarId>/recording.mp4 -> webinars.recording_file_size
 *   notes/<course>/<recId>/notes.pdf             -> content_items.notes_pdf_size
 *   thumbnails/<course>/<recId>/thumb.jpg        -> content_items.thumbnail_size
 *
 * Env (from .env.local or the shell): the CLOUDFLARE_R2_* vars +
 *   NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from "node:fs";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

// ---- env ----
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env.local — rely on shell env */
}

const APPLY = process.argv.includes("--apply");
const endpoint = (process.env.CLOUDFLARE_R2_ENDPOINT || `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
const Bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const s3 = new S3Client({
  region: "auto",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: (process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: (process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "").trim(),
  },
});

const mb = (b) => (b / 1024 / 1024).toFixed(1);

async function listObjects() {
  const all = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket, ContinuationToken: token }));
    for (const o of res.Contents || []) all.push({ key: o.Key, size: o.Size || 0 });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return all;
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  return import("@supabase/supabase-js").then(({ createClient }) => createClient(url, key, { auth: { persistSession: false } }));
}

async function main() {
  if (!Bucket) throw new Error("CLOUDFLARE_R2_BUCKET_NAME missing.");
  const supa = await db();
  const objects = await listObjects();

  // R2 sizes keyed by target id.
  const contentVideo = new Map();  // recId -> bytes
  const contentNotes = new Map();  // recId -> bytes
  const contentThumb = new Map();  // recId -> bytes
  const webinarVideo = new Map();  // webinarId -> bytes

  for (const o of objects) {
    const parts = o.key.split("/");
    if (o.key.startsWith("processed/webinars/") && parts.length >= 4) {
      webinarVideo.set(parts[2], o.size);
    } else if (o.key.startsWith("processed/") && parts.length >= 4) {
      contentVideo.set(parts[2], o.size);
    } else if (o.key.startsWith("notes/") && parts.length >= 4) {
      contentNotes.set(parts[2], o.size);
    } else if (o.key.startsWith("thumbnails/") && parts.length >= 4) {
      contentThumb.set(parts[2], o.size);
    }
  }

  const { data: content, error: cErr } = await supa
    .from("content_items")
    .select("id, file_size, notes_pdf_size, thumbnail_size, processed_key, notes_pdf_key, thumbnail_key");
  if (cErr) throw new Error(`content_items read failed: ${cErr.message}`);
  const { data: webinars, error: wErr } = await supa
    .from("webinars")
    .select("id, recording_key, recording_file_size");
  if (wErr) throw new Error(`webinars read failed: ${wErr.message}`);

  // Plan updates: only where DB size is NULL and R2 has a size.
  const contentUpdates = [];
  for (const c of content || []) {
    const patch = {};
    if ((c.file_size == null) && contentVideo.has(c.id)) patch.file_size = contentVideo.get(c.id);
    if ((c.notes_pdf_size == null) && contentNotes.has(c.id)) patch.notes_pdf_size = contentNotes.get(c.id);
    if ((c.thumbnail_size == null) && contentThumb.has(c.id)) patch.thumbnail_size = contentThumb.get(c.id);
    if (Object.keys(patch).length) contentUpdates.push({ id: c.id, patch });
  }
  const webinarUpdates = [];
  for (const w of webinars || []) {
    if (w.recording_file_size == null && webinarVideo.has(w.id)) {
      webinarUpdates.push({ id: w.id, patch: { recording_file_size: webinarVideo.get(w.id) } });
    }
  }

  const sumPatch = (arr) => arr.reduce((s, u) => s + Object.values(u.patch).reduce((a, b) => a + Number(b || 0), 0), 0);
  console.log(`\nContent-size backfill — bucket "${Bucket}"  (${APPLY ? "APPLY" : "DRY-RUN"})`);
  console.log(`  R2 objects scanned: ${objects.length}`);
  console.log(`  content_items to size: ${contentUpdates.length}  (~${mb(sumPatch(contentUpdates))} MB)`);
  console.log(`  webinars to size:      ${webinarUpdates.length}  (~${mb(sumPatch(webinarUpdates))} MB)\n`);

  for (const u of contentUpdates) console.log(`  ${APPLY ? "SET" : "would set"} content ${u.id}  ${JSON.stringify(u.patch)}`);
  for (const u of webinarUpdates) console.log(`  ${APPLY ? "SET" : "would set"} webinar ${u.id}  ${JSON.stringify(u.patch)}`);

  if (!APPLY) {
    console.log("\n  Dry-run only. Re-run with --apply to write the sizes above.\n");
    return;
  }

  let ok = 0, fail = 0;
  for (const u of [...contentUpdates.map((x) => ({ ...x, table: "content_items" })), ...webinarUpdates.map((x) => ({ ...x, table: "webinars" }))]) {
    const { error } = await supa.from(u.table).update(u.patch).eq("id", u.id);
    if (error) { fail++; console.error(`  ✗ ${u.table} ${u.id}: ${error.message}`); } else ok++;
  }
  console.log(`\n  Updated ${ok} row(s)${fail ? `, ${fail} failed` : ""}.\n`);
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
