import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/dataProvider";
import { isR2Ready, careerFileKey, signCareerUpload } from "@/lib/careers/storage";
import { CAREER_ALLOWED_UPLOAD_TYPES, CAREER_MAX_UPLOAD_BYTES } from "@/lib/careers/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Mint a short-lived signed PUT so a candidate's browser uploads a resume /
 * marksheet straight to a PRIVATE R2 key (never public). Server enforces the
 * type + size allowlist before signing; the object itself is validated again on
 * apply. Rate-limited per IP to deter abuse.
 */
export async function POST(req: Request) {
  try {
    if (!isR2Ready()) {
      return NextResponse.json({ ok: false, error: "Uploads are temporarily unavailable." }, { status: 503 });
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    if (await rateLimited(`careers-upload:${ip}`, 40, 600)) {
      return NextResponse.json({ ok: false, error: "Too many uploads. Please try again shortly." }, { status: 429 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      fileName?: string;
      contentType?: string;
      size?: number;
      uploadId?: string;
      field?: string;
    };
    const contentType = (body.contentType || "").toLowerCase();
    if (!CAREER_ALLOWED_UPLOAD_TYPES.includes(contentType)) {
      return NextResponse.json({ ok: false, error: "Unsupported file type. Use PDF, DOC, DOCX or an image." }, { status: 400 });
    }
    if ((body.size || 0) > CAREER_MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: "File is too large (max 10MB)." }, { status: 400 });
    }
    const uploadId = String(body.uploadId || "").trim();
    if (!uploadId) {
      return NextResponse.json({ ok: false, error: "Missing upload session." }, { status: 400 });
    }

    const key = careerFileKey(uploadId, contentType);
    const uploadUrl = await signCareerUpload(key, contentType, 600);
    return NextResponse.json({
      ok: true,
      uploadUrl,
      file: {
        field: String(body.field || "").slice(0, 60),
        key,
        name: String(body.fileName || "file").slice(0, 180),
        content_type: contentType,
        size: body.size || 0,
        uploaded_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error("[careers/upload] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "Could not start the upload." }, { status: 500 });
  }
}
