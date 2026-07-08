#!/usr/bin/env node
/**
 * WS1 — Migrate EXTERNAL note/document links into OUR Cloudflare R2.
 *
 * Some note/document content_items (booklet, mcq, pyq, current_affairs,
 * answer_writing, test_series, notes) point drive_link at an EXTERNAL url
 * (Google Drive, etc.). For every such item this script:
 *   1. Probes the link — is it a REAL, downloadable file? (Drive 404 / private /
 *      HTML page = NOT resolvable → left untouched, flagged for manual upload.)
 *   2. If resolvable: downloads the bytes, uploads them to R2 under
 *      media/content-notes/<id>/file.<ext> (same layout as the notes-upload
 *      feature), then sets drive_link → the STABLE /api/media url, populates
 *      notes_pdf_key + notes_pdf_size, and PRESERVES the original url in
 *      original_source_url (so the migration is fully reversible/auditable).
 *
 * SAFE BY DEFAULT:
 *   • DRY-RUN unless --apply. Prints exactly what it would do.
 *   • IDEMPOTENT: skips items already served from /api/media or already migrated
 *     (original_source_url set). Never overwrites an existing note file.
 *   • Per-item try/catch: one bad link can NEVER abort the whole run.
 *
 *   node scripts/migrate-external-notes.mjs           # DRY-RUN (default)
 *   node scripts/migrate-external-notes.mjs --apply    # write to R2 + DB
 *
 * Env (from .env.local or shell): CLOUDFLARE_R2_* + SUPABASE_URL/
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ optional
 *   NEXT_PUBLIC_SITE_URL, defaults https://namanias.com).
 */
import { readFileSync } from "node:fs";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// ---- env ----
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* rely on shell env */
}

const APPLY = process.argv.includes("--apply");
const endpoint = (process.env.CLOUDFLARE_R2_ENDPOINT || `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
const Bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://namanias.com").replace(/\/$/, "");
const VIDEO_TYPES = new Set(["recording", "live_link"]);
const MAX_BYTES = 100 * 1024 * 1024;

const CT_EXT = new Map([
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);

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

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  return import("@supabase/supabase-js").then(({ createClient }) => createClient(url, key, { auth: { persistSession: false } }));
}

/** Is this drive_link EXTERNAL (not already ours)? */
function isExternal(link) {
  if (!link || !/^https?:\/\//i.test(link)) return false;
  if (link.includes("/api/media/")) return false;
  if (link.includes(".r2.cloudflarestorage.com")) return false;
  const cdn = (process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (cdn && link.startsWith(cdn + "/")) return false;
  return true;
}

/** Extract a Google-Drive file id, else null. */
function driveId(link) {
  const m = link.match(/\/file\/d\/([^/]+)/) || link.match(/[?&]id=([^&]+)/);
  return m ? m[1] : null;
}

/**
 * Try to fetch a real file from a link. Returns { buf, contentType } or throws
 * a descriptive error (404, not-a-file, too-large, …). Never mutates anything.
 */
async function fetchFile(link) {
  const id = driveId(link);
  const url = id ? `https://drive.google.com/uc?export=download&id=${id}` : link;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length === 0) throw new Error("empty response");
  if (buf.length > MAX_BYTES) throw new Error(`too large (${kb(buf.length)}KB)`);
  // Trust the file magic over the header: a real PDF starts with "%PDF".
  const isPdfMagic = buf.slice(0, 4).toString("latin1") === "%PDF";
  if (isPdfMagic) ct = "application/pdf";
  // Reject HTML (Drive "file not found" / login / virus-scan interstitial).
  if (ct.startsWith("text/html") || (!isPdfMagic && buf.slice(0, 15).toString("latin1").toLowerCase().includes("<!doctype html"))) {
    throw new Error("link returns an HTML page, not a file");
  }
  if (!CT_EXT.has(ct)) throw new Error(`unsupported type "${ct || "unknown"}"`);
  return { buf, contentType: ct };
}

async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!Bucket) throw new Error("CLOUDFLARE_R2_BUCKET_NAME missing.");
  const supa = await db();

  const { data: items, error } = await supa
    .from("content_items")
    .select("id, type, title, drive_link, notes_pdf_key, notes_pdf_size, original_source_url");
  if (error) throw new Error(`content_items read failed: ${error.message}`);

  const candidates = (items || []).filter(
    (c) => !VIDEO_TYPES.has(c.type) && isExternal(c.drive_link) && !c.original_source_url,
  );

  console.log(`\nMigrate external notes → R2 — bucket "${Bucket}"  (${APPLY ? "APPLY" : "DRY-RUN"})`);
  console.log(`  external candidates: ${candidates.length}\n`);

  const results = [];
  for (const c of candidates) {
    let probe;
    try {
      probe = await fetchFile(c.drive_link);
    } catch (e) {
      results.push({ c, resolvable: false, reason: e.message });
      console.log(`  SKIP  [${c.type}] ${c.title}\n        ${c.drive_link}\n        → not resolvable: ${e.message} (leave for manual upload)`);
      continue;
    }

    const ext = CT_EXT.get(probe.contentType);
    const key = `media/content-notes/${c.id}/file.${ext}`;
    const stableUrl = `${SITE_URL}/api/media/content-notes/${c.id}/file.${ext}`;
    const size = probe.buf.length;
    results.push({ c, resolvable: true, key, size });
    console.log(`  MOVE  [${c.type}] ${c.title}  (${kb(size)}KB ${ext})\n        ${c.drive_link}\n        → ${stableUrl}`);

    if (!APPLY) continue;

    try {
      if (await objectExists(key)) {
        console.log(`        (object already exists — reusing, not re-uploading)`);
      } else {
        await s3.send(new PutObjectCommand({ Bucket, Key: key, Body: probe.buf, ContentType: probe.contentType }));
      }
      const { error: e } = await supa
        .from("content_items")
        .update({
          drive_link: stableUrl,
          notes_pdf_key: key,
          notes_pdf_size: size,
          original_source_url: c.drive_link, // preserve for reversibility
        })
        .eq("id", c.id);
      if (e) throw new Error(e.message);
      console.log(`        ✓ uploaded + DB updated`);
    } catch (e) {
      console.error(`        ✗ FAILED: ${e.message}`);
    }
  }

  const movable = results.filter((r) => r.resolvable).length;
  const skipped = results.filter((r) => !r.resolvable).length;
  console.log(`\n  Summary: ${movable} resolvable → migrate, ${skipped} unresolvable → manual upload.`);
  if (!APPLY) console.log("  Dry-run only. Re-run with --apply to migrate resolvable files.\n");
  else console.log("  Done.\n");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
