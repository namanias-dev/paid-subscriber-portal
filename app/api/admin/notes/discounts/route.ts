import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { createDiscountCode, listDiscountCodes, type DiscountWriteInput } from "@/lib/store/discountCodes";
import { istLocalToUtcIso } from "@/lib/store/discountPricing";
import { invalidateStoreFlagCache, storeFeatureEnabled } from "@/lib/store/flags";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function schedule(body: DiscountWriteInput & { starts_date?: string; starts_time?: string; expires_date?: string; expires_time?: string }): DiscountWriteInput {
  const starts = body.starts_date ? istLocalToUtcIso(body.starts_date, body.starts_time || "00:00") : body.starts_at || null;
  const expires = body.expires_date ? istLocalToUtcIso(body.expires_date, body.expires_time || "23:59") : body.expires_at || null;
  return { ...body, starts_at: starts, expires_at: expires };
}

export async function GET() {
  if (!(await requirePermission("store_manage_catalogue"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const codes = await listDiscountCodes();
  const db = storeDb();
  const { data: products } = db
    ? await db.from("store_products").select("id,name,sku,is_active").is("archived_at", null).order("name")
    : { data: [] };
  return noStore({
    ok: true,
    enabled: await storeFeatureEnabled("notes_store_coupons"),
    server_now: new Date().toISOString(),
    codes,
    products: products || [],
  });
}

export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_catalogue"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  try {
    const body = schedule(await req.json());
    const actor = await getActionActor();
    const code = await createDiscountCode(body, actor?.name || actor?.id || null);
    return noStore({ ok: true, code });
  } catch (error) {
    return noStore({ ok: false, error: (error as Error).message }, 400);
  }
}

export async function PATCH(req: Request) {
  if (!(await requirePermission("store_manage_catalogue"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return noStore({ ok: false, error: "Invalid update" }, 400);
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "store unavailable" }, 500);
  const { error } = await db.from("app_feature_flags").upsert({
    key: "notes_store_coupons",
    enabled: body.enabled,
    scope: body.enabled ? "all" : "off",
    kill_switch: false,
    updated_at: new Date().toISOString(),
  });
  if (error) return noStore({ ok: false, error: "Could not update the discount switch." }, 400);
  invalidateStoreFlagCache();
  return noStore({ ok: true, enabled: body.enabled });
}
