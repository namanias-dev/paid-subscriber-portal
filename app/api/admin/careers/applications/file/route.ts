import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { isCareerFileKey, signCareerDownload, isR2Ready } from "@/lib/careers/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin-only secure download for an applicant file. Validates the key is a real
 * careers upload, then 302-redirects to a short-lived signed GET URL. Applicant
 * files are private in R2 and only reachable through this authenticated route.
 */
export async function GET(req: Request) {
  if (!(await requirePermission("manage_careers"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isR2Ready()) {
    return NextResponse.json({ ok: false, error: "Storage not configured." }, { status: 503 });
  }
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!isCareerFileKey(key)) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }
  try {
    const url = await signCareerDownload(key, 300);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }
}
