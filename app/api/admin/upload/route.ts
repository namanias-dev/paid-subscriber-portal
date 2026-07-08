import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { r2Configured, mediaAssetKey, putObject, publicCdnUrl } from "@/lib/r2";
import { SITE_URL } from "@/lib/config";

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

    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const buffer = Buffer.from(await file.arrayBuffer());

    // Primary path: store the asset in Cloudflare R2 (single source of truth for
    // all new file uploads). Returns an absolute URL — the public CDN base when
    // configured, otherwise our /api/media proxy (which signs/redirects to R2).
    if (r2Configured()) {
      const key = mediaAssetKey(folder, ext); // media/{folder}/{name}.{ext}
      await putObject(key, buffer, file.type || undefined);
      const url = publicCdnUrl(key) || `${SITE_URL}/api/media/${key.slice("media/".length)}`;
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
