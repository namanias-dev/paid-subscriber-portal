import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { r2Configured, signUploadPartUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Mint short-lived presigned PUT URL(s) for specific multipart part numbers.
 * The browser PUTs each chunk DIRECTLY to R2 — bytes never touch our server.
 * Accepts a single `partNumber` or a batch `partNumbers: number[]`.
 */
export async function POST(req: Request) {
  if (!(await getAdminSession())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Video hosting is not configured." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const key = String(body.key || "");
  const uploadId = String(body.uploadId || "");
  if (!key || !uploadId) return NextResponse.json({ ok: false, error: "key and uploadId required" }, { status: 400 });

  try {
    if (Array.isArray(body.partNumbers)) {
      const nums = (body.partNumbers as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
      const urls = await Promise.all(nums.map(async (n) => ({ partNumber: n, url: await signUploadPartUrl(key, uploadId, n) })));
      return NextResponse.json({ ok: true, urls });
    }
    const partNumber = Number(body.partNumber);
    if (!Number.isFinite(partNumber) || partNumber < 1) return NextResponse.json({ ok: false, error: "partNumber required" }, { status: 400 });
    const url = await signUploadPartUrl(key, uploadId, partNumber);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Could not sign part" }, { status: 500 });
  }
}
