import { randomUUID } from "crypto";
import { signPutUrl, signGetUrl, deleteObject, r2Configured } from "@/lib/r2";
import { CAREER_EXT_BY_TYPE } from "./config";

/**
 * Careers file storage — private Cloudflare R2 keys under `careers/`. These are
 * NEVER served through the public /api/media proxy; applicant files are only
 * reachable by authenticated admins via short-lived signed GET URLs.
 *
 * Reuses the shared R2 primitives from lib/r2.ts (no changes to that module).
 */

const CAREER_PREFIX = "careers/applications/";

/** True if a key is a legitimate careers upload (defends the admin download route). */
export function isCareerFileKey(key: string): boolean {
  return (
    typeof key === "string" &&
    key.startsWith(CAREER_PREFIX) &&
    !key.includes("..") &&
    !key.includes("//")
  );
}

/**
 * Build a private key for an applicant upload. `uploadId` groups all files for a
 * single (in-progress) application; it's a random token minted before submit.
 */
export function careerFileKey(uploadId: string, contentType: string): string {
  const safeUpload = (uploadId || "").replace(/[^a-z0-9-]/gi, "").slice(0, 64) || randomUUID();
  const ext = CAREER_EXT_BY_TYPE[contentType] || "bin";
  const fileId = randomUUID();
  return `${CAREER_PREFIX}${safeUpload}/${fileId}.${ext}`;
}

export function isR2Ready(): boolean {
  return r2Configured();
}

/** Mint a short-lived signed PUT so the browser uploads straight to R2. */
export function signCareerUpload(key: string, contentType: string, ttl = 600): Promise<string> {
  return signPutUrl(key, contentType, ttl);
}

/** Mint a short-lived signed GET for an admin to download an applicant file. */
export function signCareerDownload(key: string, ttl = 300): Promise<string> {
  return signGetUrl(key, ttl);
}

/** Best-effort delete (used when an application is deleted). Never throws. */
export async function deleteCareerFile(key: string): Promise<boolean> {
  if (!isCareerFileKey(key)) return false;
  return deleteObject(key);
}
