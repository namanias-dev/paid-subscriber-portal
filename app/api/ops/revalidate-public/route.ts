import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/journey-automation/engine/cronAuth";
import { PUBLIC_CACHE_TAGS, revalidatePublicTags, type PublicCacheTag } from "@/lib/publicCache";

export const dynamic = "force-dynamic";

const ALL = Object.values(PUBLIC_CACHE_TAGS);

/**
 * On-demand public cache bust (CRON_SECRET).
 * POST /api/ops/revalidate-public?secret=…  body: { "tags": ["public-ca-articles"] }
 * Omit tags to revalidate all public content tags.
 */
export async function POST(req: Request) {
  if (!authorizeCron(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body?.tags) ? (body.tags as unknown[]) : null;
  const tags = (raw || ALL).filter((t): t is PublicCacheTag => typeof t === "string" && (ALL as string[]).includes(t));
  revalidatePublicTags(...tags);
  return NextResponse.json({ ok: true, tags });
}
