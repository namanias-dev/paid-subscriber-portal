import { getSupabaseAdmin } from "@/lib/supabase";
import { r2Configured, deleteObject, listAllObjects, type R2Object } from "@/lib/r2";
import { recordingKeys } from "@/lib/r2Cleanup";
import type { ContentItem, Webinar, CaPdf } from "@/lib/types";

/**
 * ============================================================================
 *  GLOBAL MEDIA DELETE-CASCADE  (Cloudflare R2)
 * ----------------------------------------------------------------------------
 *  One place that owns the DESTRUCTIVE part of "delete content → delete its
 *  files". Built defensively because a bug here is irreversible data loss:
 *
 *   • SCOPE GUARD    — only ever touches keys under the app's OWN prefixes,
 *                      by explicit resolved key. Never a prefix/bucket-wide
 *                      delete. Careers + payment-proofs are OUT of scope.
 *   • REFERENCE CHECK— never deletes an object another LIVE record still points
 *                      at (a webinar reusing a course video; a note sharing a
 *                      CA-PDF object). Checked at enqueue AND again at purge.
 *   • GRACE WINDOW   — deletes are ENQUEUED (media_deletion_log, status
 *                      'pending', purge_after = now+grace). The object survives
 *                      the window so an accidental delete is recoverable; the
 *                      media-purge cron removes it only after the grace period.
 *   • AUDIT LOG      — every decision (enqueue/skip/purge/missing/fail) is
 *                      recorded with who/what/which key/result/when.
 *   • ORDER          — callers delete/mark the DB row FIRST, then call the
 *                      cascade, so an R2 hiccup never blocks removing content.
 *
 *  Reuses the existing R2 client + key layout; adds no new storage provider.
 * ============================================================================
 */

/** Prefixes the cascade / orphan tool is EVER allowed to delete under. */
export const APP_DELETABLE_PREFIXES = [
  "processed/",              // hosted lecture + webinar videos
  "thumbnails/",             // lecture thumbnails
  "notes/",                  // lecture-attached notes PDFs (legacy layout)
  "media/content-notes/",    // uploaded/migrated standalone note PDFs
  "media/current-affairs/pdfs/", // current-affairs PDFs (shared: ca_pdfs + notes)
] as const;

/** Grace window (hours) before an enqueued object is actually purged. */
export const GRACE_HOURS = Math.max(0, Number(process.env.MEDIA_PURGE_GRACE_HOURS ?? 48));

export type MediaOwnerType = "content_item" | "webinar" | "ca_pdf" | "orphan";

/** Scope guard: a key we are structurally allowed to delete. */
export function isDeletableKey(key: string | null | undefined): key is string {
  if (!key || typeof key !== "string") return false;
  if (key.includes("..") || key.includes("//")) return false;
  return APP_DELETABLE_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Resolve a stored value — either a raw R2 key or a URL we control (the
 * /api/media proxy, a direct presigned R2 url, or the public CDN base) — to the
 * underlying R2 object key. Returns null for external links (Google Drive, …)
 * or anything we don't own. Never throws.
 */
export function resolveOwnKey(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  // Already a bare key under an app prefix.
  if (!/^https?:\/\//i.test(raw)) {
    return APP_DELETABLE_PREFIXES.some((p) => raw.startsWith(p)) ? raw : null;
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  // (A) Direct presigned R2 URL: <host>/<bucket>/<key>?X-Amz-…
  if (u.hostname.endsWith(".r2.cloudflarestorage.com")) {
    let path = u.pathname.replace(/^\/+/, "");
    const bucket = (process.env.CLOUDFLARE_R2_BUCKET_NAME || "").trim();
    if (bucket && path.startsWith(`${bucket}/`)) path = path.slice(bucket.length + 1);
    return path || null;
  }

  // (B) Our stable media proxy: <site>/api/media/<rest>  → key = media/<rest>.
  const mediaIdx = u.pathname.indexOf("/api/media/");
  if (mediaIdx !== -1) {
    const rest = u.pathname.slice(mediaIdx + "/api/media/".length).replace(/^\/+/, "");
    return rest ? `media/${rest}` : null;
  }

  // (C) Public CDN base (if configured): <cdnBase>/<key>.
  const cdn = (process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (cdn && raw.startsWith(cdn + "/")) {
    return raw.slice(cdn.length + 1).split("?")[0] || null;
  }

  return null; // external link we don't own
}

// ---------------------------------------------------------------------------
//  Per-type key resolution — every R2 object a record could own.
// ---------------------------------------------------------------------------

/** All R2 keys a content_item owns (hosted video/thumb/notes + migrated note). */
export function contentItemKeys(rec: ContentItem): string[] {
  const keys = new Set<string>();
  // Hosted recordings own video/thumb/notes (canonical + stored) — reuse the
  // proven recordingKeys() logic so we stay in lock-step with it.
  if (rec.source_type === "hosted") {
    for (const k of recordingKeys(rec)) keys.add(k);
  }
  // Notes/document items (link/uploaded) own their notes_pdf_key and/or a
  // drive_link that resolves into our bucket (uploaded or migrated PDFs).
  const notesKey = resolveOwnKey(rec.notes_pdf_key) || resolveOwnKey(rec.drive_link);
  if (notesKey) keys.add(notesKey);
  // Only ever return keys we're allowed to delete.
  return [...keys].filter(isDeletableKey);
}

/** R2 keys a webinar owns. A REFERENCED recording (shared) is never returned. */
export function webinarKeys(w: Webinar): string[] {
  const keys = new Set<string>();
  if (w.recording_key && !w.recording_is_reference) {
    const k = resolveOwnKey(w.recording_key);
    if (k) keys.add(k);
  }
  if (w.recording_multipart_key) {
    const k = resolveOwnKey(w.recording_multipart_key);
    if (k) keys.add(k);
  }
  return [...keys].filter(isDeletableKey);
}

/** R2 key a current-affairs PDF owns (stored as a url in file_url). */
export function caPdfKeys(p: CaPdf): string[] {
  const k = resolveOwnKey(p.file_url);
  return k && isDeletableKey(k) ? [k] : [];
}

// ---------------------------------------------------------------------------
//  Reference index — which LIVE records point at which R2 key.
// ---------------------------------------------------------------------------

export interface OwnerRef {
  type: MediaOwnerType;
  id: string;
}

/**
 * Build a map: R2 key → the live records that reference it. Used to guarantee we
 * never delete an object still in use by another record (shared/duplicate keys).
 * Reads every media-owning table once (small tables; safe + simple).
 */
export async function buildReferenceIndex(): Promise<Map<string, OwnerRef[]>> {
  const db = getSupabaseAdmin();
  const index = new Map<string, OwnerRef[]>();
  if (!db) return index;

  const add = (key: string | null, ref: OwnerRef) => {
    if (!key) return;
    const list = index.get(key) || [];
    list.push(ref);
    index.set(key, list);
  };

  const [contentRes, webinarRes, caRes] = await Promise.all([
    db.from("content_items").select("id, source_type, course_id, course_ids, processed_key, multipart_key, thumbnail_key, notes_pdf_key, drive_link"),
    db.from("webinars").select("id, recording_key, recording_multipart_key, recording_is_reference"),
    db.from("ca_pdfs").select("id, file_url"),
  ]);

  for (const c of (contentRes.data as ContentItem[]) || []) {
    for (const k of contentItemKeys(c)) add(k, { type: "content_item", id: c.id });
    // Raw keys that contentItemKeys may not surface for non-hosted rows, and
    // the multipart target, still HOLD the object — count them as references.
    for (const raw of [c.processed_key, c.multipart_key, c.thumbnail_key, c.notes_pdf_key]) {
      const k = resolveOwnKey(raw);
      if (k) add(k, { type: "content_item", id: c.id });
    }
  }
  for (const w of (webinarRes.data as Webinar[]) || []) {
    // A webinar's recording_key HOLDS the object whether owned OR referenced —
    // both must block deletion by another record.
    const rk = resolveOwnKey(w.recording_key);
    if (rk) add(rk, { type: "webinar", id: w.id });
    const mk = resolveOwnKey(w.recording_multipart_key);
    if (mk) add(mk, { type: "webinar", id: w.id });
  }
  for (const p of (caRes.data as CaPdf[]) || []) {
    for (const k of caPdfKeys(p)) add(k, { type: "ca_pdf", id: p.id });
  }

  return index;
}

/** True if any record OTHER than `owner` references `key`. */
export function isReferencedElsewhere(index: Map<string, OwnerRef[]>, key: string, owner: OwnerRef): boolean {
  const refs = index.get(key);
  if (!refs) return false;
  return refs.some((r) => !(r.type === owner.type && r.id === owner.id));
}

// ---------------------------------------------------------------------------
//  Audit log helpers.
// ---------------------------------------------------------------------------

export type MediaLogAction = "enqueue" | "purge" | "orphan_reclaim" | "immediate";
export type MediaLogStatus =
  | "pending"
  | "purged"
  | "deleted"
  | "skipped_referenced"
  | "missing"
  | "failed"
  | "out_of_scope";

export interface MediaLogRow {
  actor?: string | null;
  content_type?: MediaOwnerType | null;
  content_id?: string | null;
  content_title?: string | null;
  r2_key: string;
  size_bytes?: number | null;
  action: MediaLogAction;
  status: MediaLogStatus;
  reason?: string | null;
  purge_after?: string | null;
}

/** Best-effort append to media_deletion_log. Never throws. */
export async function logMedia(rows: MediaLogRow[]): Promise<void> {
  if (!rows.length) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("media_deletion_log").insert(rows).then(undefined, () => {});
}

// ---------------------------------------------------------------------------
//  Enqueue: the cascade entry point called by delete routes.
// ---------------------------------------------------------------------------

export interface EnqueueResult {
  scheduled: string[];        // keys queued for purge after the grace window
  skippedReferenced: string[]; // shared keys another live record still uses
  outOfScope: string[];       // keys outside our deletable prefixes (ignored)
  graceHours: number;
}

export interface EnqueueArgs {
  keys: string[];
  owner: OwnerRef;
  title?: string | null;
  actor?: string | null;
  /** Provide a prebuilt index to avoid re-reading tables (optional). */
  index?: Map<string, OwnerRef[]>;
}

/**
 * Schedule an owner's R2 keys for grace-period purge. The owner's DB row should
 * already be deleted/tombstoned by the caller. Reference-checked + scoped +
 * audited. Never throws; returns a summary for the API response.
 */
export async function enqueuePurge(args: EnqueueArgs): Promise<EnqueueResult> {
  const graceHours = GRACE_HOURS;
  const res: EnqueueResult = { scheduled: [], skippedReferenced: [], outOfScope: [], graceHours };
  const uniqueKeys = [...new Set(args.keys)];
  if (!uniqueKeys.length || !r2Configured()) return res;

  const index = args.index || (await buildReferenceIndex());
  const purgeAfter = new Date(Date.now() + graceHours * 3600_000).toISOString();
  const rows: MediaLogRow[] = [];

  for (const key of uniqueKeys) {
    if (!isDeletableKey(key)) {
      res.outOfScope.push(key);
      rows.push({ ...base(args), r2_key: key, action: "enqueue", status: "out_of_scope", reason: "outside app-deletable prefixes" });
      continue;
    }
    if (isReferencedElsewhere(index, key, args.owner)) {
      res.skippedReferenced.push(key);
      const others = (index.get(key) || []).filter((r) => !(r.type === args.owner.type && r.id === args.owner.id));
      rows.push({ ...base(args), r2_key: key, action: "enqueue", status: "skipped_referenced", reason: `still used by ${others.map((o) => `${o.type}:${o.id}`).join(", ")}` });
      continue;
    }
    res.scheduled.push(key);
    rows.push({ ...base(args), r2_key: key, action: "enqueue", status: "pending", purge_after: purgeAfter });
  }

  await logMedia(rows);
  return res;
}

function base(args: EnqueueArgs): Omit<MediaLogRow, "r2_key" | "action" | "status"> {
  return { actor: args.actor ?? null, content_type: args.owner.type, content_id: args.owner.id, content_title: args.title ?? null };
}

// ---------------------------------------------------------------------------
//  Purge: the grace-period cron. Deletes due, still-unreferenced objects.
// ---------------------------------------------------------------------------

export interface PurgeResult {
  purged: string[];
  skippedReferenced: string[];
  missing: string[];
  failed: string[];
}

/**
 * Delete R2 objects whose grace window has elapsed. Re-checks references at
 * purge time (something may have started using the key during the window) and
 * treats already-gone objects as success. Idempotent + safe to run repeatedly.
 */
export async function purgeDueMedia(limit = 500): Promise<PurgeResult> {
  const out: PurgeResult = { purged: [], skippedReferenced: [], missing: [], failed: [] };
  const db = getSupabaseAdmin();
  if (!db || !r2Configured()) return out;

  const nowIso = new Date().toISOString();
  const { data } = await db
    .from("media_deletion_log")
    .select("id, r2_key, content_type, content_id, content_title, actor")
    .eq("status", "pending")
    .lte("purge_after", nowIso)
    .limit(limit);

  const due = (data as { id: string; r2_key: string; content_type: MediaOwnerType | null; content_id: string | null; content_title: string | null; actor: string | null }[]) || [];
  if (!due.length) return out;

  const index = await buildReferenceIndex();
  const objectExists = new Set((await listAllObjects()).map((o) => o.key));

  for (const row of due) {
    const owner: OwnerRef = { type: (row.content_type || "orphan") as MediaOwnerType, id: row.content_id || "" };

    // Guard again: never purge a key that's back in use or out of scope.
    if (!isDeletableKey(row.r2_key)) {
      out.failed.push(row.r2_key);
      await resolveRow(db, row.id, "failed", "out of scope at purge");
      continue;
    }
    if (isReferencedElsewhere(index, row.r2_key, owner)) {
      out.skippedReferenced.push(row.r2_key);
      await resolveRow(db, row.id, "skipped_referenced", "referenced by another record at purge time");
      continue;
    }
    if (!objectExists.has(row.r2_key)) {
      out.missing.push(row.r2_key);
      await resolveRow(db, row.id, "missing", "object already gone");
      continue;
    }
    const ok = await deleteObject(row.r2_key);
    if (ok) {
      out.purged.push(row.r2_key);
      await resolveRow(db, row.id, "purged");
    } else {
      out.failed.push(row.r2_key);
      await resolveRow(db, row.id, "failed", "R2 delete failed");
    }
  }
  return out;
}

async function resolveRow(db: ReturnType<typeof getSupabaseAdmin>, id: string, status: MediaLogStatus, reason?: string): Promise<void> {
  if (!db) return;
  await db
    .from("media_deletion_log")
    .update({ status, reason: reason ?? null, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .then(undefined, () => {});
}

// ---------------------------------------------------------------------------
//  Orphan reconciliation across ALL app-deletable prefixes.
// ---------------------------------------------------------------------------

export interface MediaOrphan {
  key: string;
  size: number;
  lastModified: string | null;
}

export interface MediaOrphanReport {
  orphans: MediaOrphan[];
  reclaimableBytes: number;
  scannedObjects: number;
  scannedAt: string;
}

/**
 * R2 objects under app-deletable prefixes that NO live record references AND are
 * not already queued for purge. Read-only. These are pre-cascade leftovers +
 * anything the cascade couldn't reach. Never lists referenced/queued keys.
 */
export async function buildMediaOrphanReport(): Promise<MediaOrphanReport> {
  const [index, objects] = await Promise.all([buildReferenceIndex(), listAllObjects()]);
  const db = getSupabaseAdmin();
  const pending = new Set<string>();
  if (db) {
    const { data } = await db.from("media_deletion_log").select("r2_key").eq("status", "pending");
    for (const r of (data as { r2_key: string }[]) || []) pending.add(r.r2_key);
  }

  const inScope = objects.filter((o) => isDeletableKey(o.key));
  const orphans = inScope
    .filter((o) => !index.has(o.key) && !pending.has(o.key))
    .map((o: R2Object) => ({ key: o.key, size: o.size, lastModified: o.lastModified }));

  return {
    orphans,
    reclaimableBytes: orphans.reduce((s, o) => s + (o.size || 0), 0),
    scannedObjects: inScope.length,
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Delete orphaned objects (explicit admin action). Re-scans server-side (never
 * trusts a client list), re-checks references, audits every deletion. Immediate
 * (no grace) because these are already unreferenced leftovers.
 */
export async function reclaimOrphans(actor?: string | null): Promise<{ deleted: string[]; failed: string[]; reclaimedBytes: number }> {
  const report = await buildMediaOrphanReport();
  const deleted: string[] = [];
  const failed: string[] = [];
  const rows: MediaLogRow[] = [];
  let reclaimedBytes = 0;

  for (const o of report.orphans) {
    if (!isDeletableKey(o.key)) continue; // paranoia; report is already scoped
    const ok = await deleteObject(o.key);
    if (ok) {
      deleted.push(o.key);
      reclaimedBytes += o.size || 0;
      rows.push({ actor: actor ?? "system", content_type: "orphan", r2_key: o.key, size_bytes: o.size, action: "orphan_reclaim", status: "deleted" });
    } else {
      failed.push(o.key);
      rows.push({ actor: actor ?? "system", content_type: "orphan", r2_key: o.key, size_bytes: o.size, action: "orphan_reclaim", status: "failed" });
    }
  }
  await logMedia(rows);
  return { deleted, failed, reclaimedBytes };
}
