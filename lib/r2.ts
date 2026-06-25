import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  ListMultipartUploadsCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MultipartPart } from "./types";

/**
 * ============================================================================
 *  CLOUDFLARE R2 (S3-compatible) — SERVER ONLY. Never import from client code.
 *  Video bytes go browser→R2 (presigned PUT) and R2→browser (presigned GET);
 *  our server only mints short-lived signed URLs + orchestrates multipart.
 *  Credentials live in env and are never returned to the client.
 * ============================================================================
 */

const UPLOAD_URL_TTL = 60 * 60; // 1h for part PUTs (a slow part shouldn't expire mid-flight)
export const PLAYBACK_TTL = Number(process.env.LECTURE_SIGNED_URL_TTL_SECONDS || 1800);

/** Always-required R2 env vars (the endpoint can be derived from ACCOUNT_ID). */
const REQUIRED_R2_VARS = [
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "CLOUDFLARE_R2_BUCKET_NAME",
] as const;

const env = (k: string) => (process.env[k] || "").trim();

/** Names of any required R2 env vars that are missing/empty (trimmed). */
export function missingR2EnvVars(): string[] {
  const missing: string[] = REQUIRED_R2_VARS.filter((k) => !env(k));
  // Need EITHER an explicit endpoint OR an account id to build one.
  if (!env("CLOUDFLARE_R2_ENDPOINT") && !env("CLOUDFLARE_R2_ACCOUNT_ID")) {
    missing.push("CLOUDFLARE_R2_ENDPOINT (or CLOUDFLARE_R2_ACCOUNT_ID)");
  }
  return missing;
}

export function r2Configured(): boolean {
  return missingR2EnvVars().length === 0;
}

/** Throws a clear, specific error naming exactly which R2 vars are missing. */
export function assertR2Configured(): void {
  const missing = missingR2EnvVars();
  if (missing.length) {
    throw new Error(`R2 not configured — missing/empty env var(s): ${missing.join(", ")}`);
  }
}

function bucket(): string {
  return process.env.CLOUDFLARE_R2_BUCKET_NAME as string;
}

/**
 * Endpoint = account host, no bucket, no trailing slash. If the explicit
 * CLOUDFLARE_R2_ENDPOINT is empty, derive it from the account id.
 */
function r2Endpoint(): string {
  const explicit = env("CLOUDFLARE_R2_ENDPOINT").replace(/\/+$/, "");
  if (explicit) return explicit;
  const acct = env("CLOUDFLARE_R2_ACCOUNT_ID");
  return acct ? `https://${acct}.r2.cloudflarestorage.com` : "";
}

let client: S3Client | null = null;
function r2(): S3Client {
  if (client) return client;
  assertR2Configured();
  client = new S3Client({
    region: "auto",
    endpoint: r2Endpoint(),
    forcePathStyle: true, // R2 requires path-style addressing
    credentials: {
      accessKeyId: (process.env.CLOUDFLARE_R2_ACCESS_KEY_ID as string).trim(),
      secretAccessKey: (process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY as string).trim(),
    },
  });
  return client;
}

// ----------------------------- Key layout -----------------------------
export function lectureVideoKey(courseId: string, recordingId: string): string {
  return `processed/${courseId || "_"}/${recordingId}/lecture.mp4`;
}
export function lectureThumbnailKey(courseId: string, recordingId: string): string {
  return `thumbnails/${courseId || "_"}/${recordingId}/thumb.jpg`;
}
export function lectureNotesKey(courseId: string, recordingId: string): string {
  return `notes/${courseId || "_"}/${recordingId}/notes.pdf`;
}

// ----------------------------- Multipart -----------------------------
export async function createMultipart(key: string, contentType = "video/mp4"): Promise<string> {
  const out = await r2().send(
    new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
  );
  if (!out.UploadId) throw new Error("R2 did not return an UploadId");
  return out.UploadId;
}

export function signUploadPartUrl(key: string, uploadId: string, partNumber: number): Promise<string> {
  return getSignedUrl(
    r2(),
    new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: UPLOAD_URL_TTL },
  );
}

export async function completeMultipart(key: string, uploadId: string, parts: MultipartPart[]): Promise<void> {
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  await r2().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: ordered.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }),
  );
}

export async function abortMultipart(key: string, uploadId: string): Promise<void> {
  await r2()
    .send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }))
    .catch(() => {});
}

/** Parts R2 already has for this upload — the source of truth for resume. */
export async function listUploadedParts(key: string, uploadId: string): Promise<MultipartPart[]> {
  const out = await r2().send(new ListPartsCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }));
  return (out.Parts || []).map((p) => ({ partNumber: p.PartNumber as number, etag: (p.ETag as string) || "" }));
}

/** Abandoned multipart uploads older than `olderThanMs` — for the cleanup safety net. */
export async function listStaleMultipart(olderThanMs: number): Promise<{ key: string; uploadId: string; initiated: string }[]> {
  const out = await r2().send(new ListMultipartUploadsCommand({ Bucket: bucket() }));
  const cutoff = Date.now() - olderThanMs;
  return (out.Uploads || [])
    .filter((u) => (u.Initiated ? u.Initiated.getTime() < cutoff : false))
    .map((u) => ({ key: u.Key as string, uploadId: u.UploadId as string, initiated: u.Initiated?.toISOString() || "" }));
}

// ----------------------------- Signed GET / PUT -----------------------------
export function signGetUrl(key: string, ttl = PLAYBACK_TTL): Promise<string> {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: ttl });
}

export function signPutUrl(key: string, contentType: string, ttl = 600): Promise<string> {
  return getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), {
    expiresIn: ttl,
  });
}

/** Public CDN URL (only used for public lectures explicitly opted into CDN caching). */
export function publicCdnUrl(key: string): string | null {
  const base = process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/${key}` : null;
}

export async function deleteObject(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => {});
}
