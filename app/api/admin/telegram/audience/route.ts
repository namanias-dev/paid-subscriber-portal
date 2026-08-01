import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { PHONE_AUDIENCES, type PhoneAudienceId } from "@/lib/adminPhoneAudiences";
import { resolveTelegramAudience } from "@/lib/telegram/audiences";

export const dynamic = "force-dynamic";

async function resolve(body: {
  audienceId?: string;
  fromMs?: number;
  toMs?: number;
  includeSample?: boolean;
}) {
  const audienceId = String(body.audienceId || "") as PhoneAudienceId;
  if (!PHONE_AUDIENCES.some((a) => a.id === audienceId)) {
    return { ok: false as const, error: "invalid_audience", status: 400 };
  }
  const toMs = Number(body.toMs) || Date.now();
  const fromMs = Number(body.fromMs) || toMs - 30 * 24 * 3600 * 1000;
  const result = await resolveTelegramAudience(audienceId, fromMs, toMs);
  return {
    ok: true as const,
    audienceId,
    fromMs,
    toMs,
    audienceSize: result.audienceSize,
    reachableCount: result.reachable.length,
    skippedNoTelegram: result.skippedNoTelegram,
    reachable: body.includeSample === false ? undefined : result.reachable.slice(0, 50),
  };
}

export async function GET(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const result = await resolve({
    audienceId: url.searchParams.get("audienceId") || undefined,
    fromMs: Number(url.searchParams.get("fromMs") || 0) || undefined,
    toMs: Number(url.searchParams.get("toMs") || 0) || undefined,
    includeSample: url.searchParams.get("sample") !== "0",
  });
  if (!result.ok) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const result = await resolve(body);
  if (!result.ok) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}
