import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { missingR2EnvVars, listStaleMultipart } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Quick R2 config diagnostic (admin-only). Reports which env vars are PRESENT
 * (booleans only — never the values) and does a live R2 ping so you can confirm
 * credentials/endpoint work BEFORE attempting an upload. Never logs secrets.
 */
export async function GET() {
  if (!(await requirePermission("content_courses"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const present = {
    CLOUDFLARE_R2_ENDPOINT: !!(process.env.CLOUDFLARE_R2_ENDPOINT || "").trim(),
    CLOUDFLARE_R2_ACCESS_KEY_ID: !!(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || "").trim(),
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: !!(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || "").trim(),
    CLOUDFLARE_R2_BUCKET_NAME: !!(process.env.CLOUDFLARE_R2_BUCKET_NAME || "").trim(),
    CLOUDFLARE_R2_ACCOUNT_ID: !!(process.env.CLOUDFLARE_R2_ACCOUNT_ID || "").trim(),
  };
  const endpointHost = (() => {
    try { return new URL((process.env.CLOUDFLARE_R2_ENDPOINT || "").trim()).host; } catch { return null; }
  })();

  const missing = missingR2EnvVars();
  if (missing.length) {
    return NextResponse.json({ ok: false, configured: false, present, endpointHost, missing });
  }

  // Live ping: lists in-progress multipart uploads (cheap, read-only).
  try {
    await listStaleMultipart(Number.MAX_SAFE_INTEGER);
    return NextResponse.json({ ok: true, configured: true, present, endpointHost, r2Reachable: true });
  } catch (e) {
    const err = e as { name?: string; message?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    return NextResponse.json({
      ok: false,
      configured: true,
      r2Reachable: false,
      present,
      endpointHost,
      code: err.Code || err.name || "UnknownError",
      error: err.message || "R2 ping failed",
      httpStatusCode: err.$metadata?.httpStatusCode ?? null,
    });
  }
}
