import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getContentById, updateContent } from "@/lib/dataProvider";
import { r2Configured, signPutUrl, contentNotesKey } from "@/lib/r2";
import { SITE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Presigned PUT for a document/notes file uploaded against a content_item
 * (type notes / booklet / pyq / mcq / current_affairs / …). The file goes
 * browser → R2 directly (bypasses the serverless request-body limit, so large
 * PDFs work), stored under `media/content-notes/<id>/…` so the existing public
 * `/api/media` proxy serves it with a STABLE url (never an expiring presigned
 * link). We persist a stable drive_link + the R2 key + size so it opens for
 * students and shows an accurate size in Content/LMS storage analytics.
 *
 * Additive: only touches the target content row's drive_link / notes_pdf_key /
 * notes_pdf_size. The existing "add link" flow is unchanged.
 */

const ALLOWED = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);

// Generous cap for study material (client→R2 direct, so not bound by the
// serverless body limit). Notes are typically a few MB; allow up to 100 MB.
const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request) {
  if (!(await requirePermission("content_courses"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!r2Configured()) {
    return NextResponse.json({ ok: false, error: "File storage is not configured." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const contentId = String(body.contentId || "");
  const contentType = String(body.contentType || "application/pdf");
  const size = Number(body.size);

  if (!contentId) {
    return NextResponse.json({ ok: false, error: "contentId required" }, { status: 400 });
  }
  const ext = ALLOWED.get(contentType);
  if (!ext) {
    return NextResponse.json({ ok: false, error: "Unsupported file type — upload a PDF, DOC or DOCX." }, { status: 415 });
  }
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: "A valid file size is required." }, { status: 400 });
  }
  if (size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File too large (max 100 MB)." }, { status: 413 });
  }

  const rec = await getContentById(contentId);
  if (!rec) return NextResponse.json({ ok: false, error: "Content not found" }, { status: 404 });

  const key = contentNotesKey(contentId, ext);
  const stableUrl = `${SITE_URL}/api/media/${key.slice("media/".length)}`;

  try {
    const url = await signPutUrl(key, contentType, 600);
    // Persist stable link + key + size. The student open-link resolver uses
    // drive_link, and storage analytics sum notes_pdf_size — so this both fixes
    // access and makes the size show up, with zero change to existing behaviour.
    await updateContent(contentId, {
      drive_link: stableUrl,
      notes_pdf_key: key,
      notes_pdf_size: Math.round(size),
    });
    return NextResponse.json({ ok: true, url, key, stableUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Could not sign upload" }, { status: 500 });
  }
}
