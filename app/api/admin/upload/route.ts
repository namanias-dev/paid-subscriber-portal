import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { r2Configured, mediaAssetKey, putObject } from "@/lib/r2";
import { stablePublicMediaUrl } from "@/lib/publicMediaUrl";

// Shared media upload used by many editors (courses, webinars, library, home,
// toppers, about, current affairs). Allow any content/settings manager.
const UPLOAD_PERMS = [
  "content_courses",
  "content_webinars",
  "content_pdfs_media",
  "content_current_affairs",
  "content_resources",
  "content_quizzes",
  "manage_settings",
] as const;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "media";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

// Served from the public media host. Block active content; SVG logos stay allowed.
const BLOCKED_UPLOAD_EXT = new Set([
  "html", "htm", "xhtml", "js", "mjs", "cjs", "jsx", "ts", "tsx",
  "php", "phtml", "exe", "sh", "bat", "cmd", "ps1", "svgz",
]);
const BLOCKED_UPLOAD_TYPES = new Set([
  "text/html",
  "application/javascript",
  "text/javascript",
  "application/x-httpd-php",
]);

export async function POST(req: Request) {
  try {
    if (!(await requireAnyPermission([...UPLOAD_PERMS]))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const folder = String(form?.get("folder") || "uploads").replace(/[^a-z0-9/_-]/gi, "") || "uploads";

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file provided." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "File too large (max 8 MB)." }, { status: 413 });
    }

    const declaredType = (file.type || "").toLowerCase().split(";")[0].trim();
    let ext = "";
    const dot = file.name.lastIndexOf(".");
    if (dot > 0 && dot < file.name.length - 1) {
      ext = file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
    }
    if (!ext && (declaredType.startsWith("image/") || declaredType === "application/pdf")) {
      ext = declaredType === "application/pdf" ? "pdf" : declaredType.slice("image/".length).replace(/[^a-z0-9]/g, "");
    }
    if (!ext || BLOCKED_UPLOAD_EXT.has(ext) || BLOCKED_UPLOAD_TYPES.has(declaredType)) {
      return NextResponse.json({ ok: false, error: "This file type is not allowed." }, { status: 415 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    // Primary path: store the asset in Cloudflare R2 (single source of truth for
    // all new file uploads). Returns a stable public URL (CDN or `/media/…`) —
    // never a presigned R2 link (those break next/image caching).
    if (r2Configured()) {
      const key = mediaAssetKey(folder, ext); // media/{folder}/{name}.{ext}
      await putObject(key, buffer, file.type || undefined);
      const url = stablePublicMediaUrl(key);
      return NextResponse.json({ ok: true, url, path: key });
    }

    // Fallback (only when R2 isn't configured): legacy Supabase Storage bucket.
    const db = getSupabaseAdmin();
    if (!db) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "File uploads need Cloudflare R2 (or Supabase Storage). Configure R2 env vars, or paste a public URL instead.",
        },
        { status: 503 }
      );
    }
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await db.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type || undefined, upsert: false });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    const { data } = db.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ ok: true, url: data.publicUrl, path });
  } catch {
    return NextResponse.json({ ok: false, error: "Upload failed." }, { status: 500 });
  }
}
