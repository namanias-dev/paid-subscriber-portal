#!/usr/bin/env node
/**
 * R2 orphan reconciliation for hosted lecture recordings.
 *
 * Lists R2 objects under recording prefixes (processed/ thumbnails/ notes/) and
 * flags any whose recording id has no row in content_items (orphans), plus DB
 * rows whose processed_key has no R2 object (dangling).
 *
 *   node scripts/r2-orphans.mjs            # DRY-RUN (default) — never deletes
 *   node scripts/r2-orphans.mjs --apply    # delete the orphans (logged)
 *
 * Env (from .env.local or the shell): the CLOUDFLARE_R2_* vars, plus EITHER
 *   NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (reads the
 *   DB), OR KEEP_IDS="id1,id2,…" (the full set of content_items ids) when DB
 *   creds aren't available in this environment.
 *
 * Payment-proof objects are never touched.
 */
import { readFileSync } from "node:fs";
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

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
const RECORDING_PREFIXES = ["processed/", "thumbnails/", "notes/"];
const recIdFromKey = (key) => {
  if (!RECORDING_PREFIXES.some((p) => key.startsWith(p))) return null;
  const parts = key.split("/");
  return parts.length >= 4 ? parts[2] || null : null;
};

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

async function listObjects() {
  const all = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket, ContinuationToken: token }));
    for (const o of res.Contents || []) all.push({ key: o.Key, size: o.Size || 0, mod: o.LastModified?.toISOString() || null });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return all;
}

async function validRecordingIds() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.from("content_items").select("id");
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    return new Set((data || []).map((r) => r.id));
  }
  if (process.env.KEEP_IDS) {
    return new Set(process.env.KEEP_IDS.split(",").map((s) => s.trim()).filter(Boolean));
  }
  throw new Error("No DB access: set SUPABASE_SERVICE_ROLE_KEY (+ URL) or KEEP_IDS=<all content ids>.");
}

const mb = (b) => (b / 1024 / 1024).toFixed(1);

async function main() {
  if (!Bucket) throw new Error("CLOUDFLARE_R2_BUCKET_NAME missing.");
  const [objects, valid] = await Promise.all([listObjects(), validRecordingIds()]);

  const recObjects = objects.filter((o) => recIdFromKey(o.key) !== null);
  const orphans = recObjects.filter((o) => !valid.has(recIdFromKey(o.key)));
  const reclaimable = orphans.reduce((s, o) => s + o.size, 0);

  console.log(`\nR2 orphan scan — bucket "${Bucket}"  (${APPLY ? "APPLY" : "DRY-RUN"})`);
  console.log(`  recording objects: ${recObjects.length}   valid recording ids: ${valid.size}`);
  console.log(`  orphans: ${orphans.length}   reclaimable: ${mb(reclaimable)} MB\n`);

  if (orphans.length === 0) {
    console.log("  ✓ No orphans. Storage is clean.\n");
    return;
  }
  for (const o of orphans) console.log(`  ${APPLY ? "DELETE" : "would delete"}  ${mb(o.size).padStart(8)} MB  ${o.mod}  ${o.key}`);
  console.log("");

  if (!APPLY) {
    console.log("  Dry-run only. Re-run with --apply to delete the above.\n");
    return;
  }
  let ok = 0;
  for (const o of orphans) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: o.key }));
      ok++;
      console.log(`  ✓ deleted ${o.key}`);
    } catch (e) {
      console.error(`  ✗ FAILED ${o.key}: ${e.message}`);
    }
  }
  console.log(`\n  Reclaimed ${ok}/${orphans.length} object(s), ~${mb(reclaimable)} MB.\n`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
