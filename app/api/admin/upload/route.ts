import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "media";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export async function POST(req: Request) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    if (!db) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "File uploads need Supabase Storage. Configure Supabase + create the public 'media' bucket, or paste a public URL instead.",
        },
        { status: 503 }
      );
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
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

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
