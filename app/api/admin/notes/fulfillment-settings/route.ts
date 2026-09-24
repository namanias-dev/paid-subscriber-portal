import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import { getFulfillmentSettings, setFulfillmentSettings } from "@/lib/store/fulfillmentSettings";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  if (!(await requirePermission("store_manage_orders"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  return noStore({ ok: true, settings: await getFulfillmentSettings() });
}

export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_orders"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const body = (await req.json().catch(() => ({}))) as {
    auto?: unknown;
    shiprocket?: unknown;
    delhivery?: unknown;
    excluded?: unknown;
    maxAttempts?: unknown;
  };
  const patch: { auto?: boolean; shiprocket?: boolean; delhivery?: boolean; excluded?: string[]; maxAttempts?: number } = {};
  if (typeof body.auto === "boolean") patch.auto = body.auto;
  if (typeof body.shiprocket === "boolean") patch.shiprocket = body.shiprocket;
  if (typeof body.delhivery === "boolean") patch.delhivery = body.delhivery;
  if (Array.isArray(body.excluded)) patch.excluded = body.excluded.map((name) => String(name));
  if (body.maxAttempts != null) patch.maxAttempts = Number(body.maxAttempts);
  const actor = await getActionActor();
  const settings = await setFulfillmentSettings(patch, { id: actor?.id ?? null, name: actor?.name ?? null });
  return noStore({ ok: true, settings });
}
