import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { r2Configured, listStaleMultipart, abortMultipart } from "@/lib/r2";

export const dynamic = "force-dynamic";

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Safety net for ABANDONED multipart uploads (started but never completed/aborted)
 * so R2 never silently bills incomplete parts. (An R2 lifecycle rule for incomplete
 * multipart uploads is the recommended belt-and-braces — documented in handoff.)
 */
export async function POST(req: Request) {
  if (!(await getAdminSession())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Video hosting is not configured." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const olderThanMs = body.olderThanHours ? Number(body.olderThanHours) * 3600_000 : DEFAULT_STALE_MS;

  try {
    const stale = await listStaleMultipart(olderThanMs);
    await Promise.all(stale.map((u) => abortMultipart(u.key, u.uploadId)));
    return NextResponse.json({ ok: true, aborted: stale.length, items: stale });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Cleanup failed" }, { status: 500 });
  }
}
