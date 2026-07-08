#!/usr/bin/env node
/**
 * Backfill Content/LMS NOTE / document sizes from Cloudflare R2, and repair
 * fragile note links.
 *
 * Many existing note/document content_items store their file as a LINK in
 * drive_link. Some of those links point at OUR R2 bucket but were saved as
 * EXPIRING presigned URLs (…r2.cloudflarestorage.com/<bucket>/<key>?X-Amz-…,
 * 24h TTL) — they break after a day. This script, for every non-video
 * content_item whose drive_link resolves to a real R2 object:
 *   • reads the object's real size (read-only ListObjectsV2 — never mutates or
 *     downloads bytes) and sets content_items.notes_pdf_size + notes_pdf_key,
 *   • rewrites an EXPIRING presigned drive_link to the STABLE /api/media proxy
 *     url (same object, no expiry) so the note keeps opening forever.
 * External links (Google Drive, etc.) and already-stable /api/media links are
 * left untouched. Existing non-null sizes are never overwritten.
 *
 *   node scripts/backfill-notes.mjs           # DRY-RUN (default) — writes nothing
 *   node scripts/backfill-notes.mjs --apply    # write to the DB
 *
 * Env (from .env.local or the shell): the CLOUDFLARE_R2_* vars +
 *   NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   (+ optional NEXT_PUBLIC_SITE_URL, defaults to https://namanias.com).
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
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://namanias.com").replace(/\/$/, "");
const VIDEO_TYPES = new Set(["recording", "live_link"]);

const s3 = new S3Client({
  region: "auto",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: (process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: (process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "").trim(),
  },
});

const kb = (b) => (b / 1024).toFixed(0);

async function listObjects() {
  const map = new Map();
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket, ContinuationToken: token }));
    for (const o of res.Contents || []) map.set(o.Key, o.Size || 0);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return map;
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  return import("@supabase/supabase-js").then(({ createClient }) => createClient(url, key, { auth: { persistSession: false } }));
}

/**
 * Resolve a drive_link to an R2 object key (under `media/…`) if it points at our
 * bucket, plus whether the link is fragile (expiring presigned) and should be
 * rewritten. Returns null for external links we don't own.
 */
function resolveR2Key(link) {
  if (!link) return null;
  let u;
  try { u = new URL(link); } catch { return null; }

  // (A) Direct presigned R2 URL: <host>/<bucket>/<key>?X-Amz-…  → EXPIRING.
  if (u.hostname.endsWith(".r2.cloudflarestorage.com")) {
    let path = u.pathname.replace(/^\/+/, "");
    if (Bucket && path.startsWith(`${Bucket}/`)) path = path.slice(Bucket.length + 1);
    if (!path) return null;
    const expiring = u.searchParams.has("X-Amz-Signature") || u.searchParams.has("X-Amz-Expires");
    return { key: path, expiring };
  }

  // (B) Our stable media proxy: <site>/api/media/<rest>  → key = media/<rest>. Stable.
  const mediaIdx = u.pathname.indexOf("/api/media/");
  if (mediaIdx !== -1) {
    const rest = u.pathname.slice(mediaIdx + "/api/media/".length).replace(/^\/+/, "");
    return rest ? { key: `media/${rest}`, expiring: false } : null;
  }

  // (C) Public CDN base (if configured): <cdnBase>/<key>. Stable.
  const cdn = (process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (cdn && link.startsWith(cdn + "/")) {
    return { key: link.slice(cdn.length + 1).split("?")[0], expiring: false };
  }

  return null; // external (Drive, etc.)
}

async function main() {
  if (!Bucket) throw new Error("CLOUDFLARE_R2_BUCKET_NAME missing.");
  const supa = await db();
  const sizeByKey = await listObjects();

  const { data: items, error } = await supa
    .from("content_items")
    .select("id, type, title, drive_link, notes_pdf_key, notes_pdf_size");
  if (error) throw new Error(`content_items read failed: ${error.message}`);

  const updates = [];
  let external = 0, missingObj = 0, alreadyOk = 0;
  for (const c of items || []) {
    if (VIDEO_TYPES.has(c.type)) continue;          // videos handled by the other script
    const resolved = resolveR2Key(c.drive_link);
    if (!resolved) { if (c.drive_link) external++; continue; }
    if (!sizeByKey.has(resolved.key)) { missingObj++; continue; } // link points at a gone object

    const size = sizeByKey.get(resolved.key);
    const patch = {};
    if (c.notes_pdf_size == null) patch.notes_pdf_size = size;
    if (c.notes_pdf_key == null) patch.notes_pdf_key = resolved.key;
    if (resolved.expiring) patch.drive_link = `${SITE_URL}/api/media/${resolved.key.slice("media/".length)}`;

    if (Object.keys(patch).length) updates.push({ id: c.id, title: c.title, type: c.type, patch });
    else alreadyOk++;
  }

  console.log(`\nNotes backfill — bucket "${Bucket}"  (${APPLY ? "APPLY" : "DRY-RUN"})`);
  console.log(`  R2 objects scanned:   ${sizeByKey.size}`);
  console.log(`  note/doc items:       ${(items || []).filter((c) => !VIDEO_TYPES.has(c.type)).length}`);
  console.log(`  → to update:          ${updates.length}`);
  console.log(`  → external links:     ${external}  (left as-is, size shows "—")`);
  console.log(`  → object missing:     ${missingObj}  (link points at a gone object — left as-is)`);
  console.log(`  → already correct:    ${alreadyOk}\n`);

  for (const u of updates) {
    const bits = [];
    if (u.patch.notes_pdf_size != null) bits.push(`size=${kb(u.patch.notes_pdf_size)}KB`);
    if (u.patch.notes_pdf_key != null) bits.push(`key`);
    if (u.patch.drive_link != null) bits.push(`repair-link`);
    console.log(`  ${APPLY ? "SET" : "would set"} [${u.type}] ${u.title}  (${bits.join(", ")})`);
  }

  if (!APPLY) {
    console.log("\n  Dry-run only. Re-run with --apply to write the changes above.\n");
    return;
  }

  let ok = 0, fail = 0;
  for (const u of updates) {
    const { error: e } = await supa.from("content_items").update(u.patch).eq("id", u.id);
    if (e) { fail++; console.error(`  ✗ ${u.id}: ${e.message}`); } else ok++;
  }
  console.log(`\n  Updated ${ok} row(s)${fail ? `, ${fail} failed` : ""}.\n`);
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
