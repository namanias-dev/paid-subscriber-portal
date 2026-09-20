import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { listInterestAggregates, type InterestSort } from "@/lib/store/interest";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  if (!(await requireAnyPermission(["store_manage_orders", "store_manage_catalogue"]))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  const url = new URL(req.url);
  const sortRaw = url.searchParams.get("sort") || "most";
  const sort: InterestSort = sortRaw === "recent" || sortRaw === "coming_soon" ? sortRaw : "most";
  const rows = await listInterestAggregates(sort);
  return noStore({
    ok: true,
    sort,
    rows,
    upcoming: rows.filter((r) => r.availability_mode === "coming_soon").slice(0, 6),
  });
}
