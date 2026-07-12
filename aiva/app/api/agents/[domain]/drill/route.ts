import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/guard";
import { getDrill } from "@/lib/insights/drill";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only drill-down: GET /api/agents/:domain/drill?metric=...&q=...&page=1
 * Returns the actual stitched records behind a clicked metric. Super-Admin only.
 */
export async function GET(req: Request, { params }: { params: { domain: string } }) {
  const gate = await requireApiSession();
  if ("response" in gate) return gate.response;

  const url = new URL(req.url);
  const metric = url.searchParams.get("metric") || "";
  const q = url.searchParams.get("q") || "";
  const page = Number(url.searchParams.get("page") || "1") || 1;
  if (!metric) return NextResponse.json({ ok: false, error: "metric is required" }, { status: 400 });

  const result = await getDrill(params.domain, metric, q, page);
  if (!result) return NextResponse.json({ ok: false, error: "Unknown drill metric." }, { status: 404 });

  await writeAudit({
    actor_id: gate.session.admin_id,
    actor_username: gate.session.username,
    action: `drill:${params.domain}:${metric}`,
    outcome: "read",
  });
  return NextResponse.json(result);
}
