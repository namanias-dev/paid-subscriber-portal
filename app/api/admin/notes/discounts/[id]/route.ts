import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { archiveDiscountCode, getDiscountCodeById, istPartsForAdmin, updateDiscountCode, type DiscountWriteInput } from "@/lib/store/discountCodes";
import { discountCapacity, istLocalToUtcIso } from "@/lib/store/discountPricing";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_catalogue"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const code = await getDiscountCodeById(params.id);
  if (!code) return noStore({ ok: false, error: "Not found" }, 404);
  const db = storeDb();
  const { data: products } = db
    ? await db.from("store_products").select("id,name,sku").is("archived_at", null).order("name")
    : { data: [] };
  const { data: orders } = db
    ? await db
        .from("store_orders")
        .select("id,order_no,status,total_paise,coupon_discount_paise,paid_at,placed_at")
        .eq("coupon_code", code.code)
        .order("placed_at", { ascending: false })
        .limit(25)
    : { data: [] };
  const { data: events } = db
    ? await db.from("store_discount_code_events").select("event,actor,created_at").eq("discount_code_id", code.id).order("created_at", { ascending: false }).limit(20)
    : { data: [] };
  const paid = (orders || []).filter((order) => order.paid_at);
  const applications = db
    ? await db.from("store_discount_code_events").select("id", { count: "exact", head: true }).eq("discount_code_id", code.id).eq("event", "applied")
    : { count: 0 };
  const capacity = discountCapacity({ max: code.max_redemptions, redeemed: code.redemption_count, reserved: code.held_count });
  return noStore({
    ok: true,
    code,
    schedule: istPartsForAdmin(code),
    products: products || [],
    orders: orders || [],
    events: events || [],
    usage: {
      redeemed: capacity.redeemed,
      reserved: capacity.reserved,
      available: capacity.available,
      applications: applications.count || 0,
      captured: capacity.redeemed,
      held: capacity.reserved,
      discount_paise: paid.reduce((sum, order) => sum + (Number(order.coupon_discount_paise) || 0), 0),
      revenue_paise: paid.reduce((sum, order) => sum + (Number(order.total_paise) || 0), 0),
    },
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_catalogue"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  try {
    const body = (await req.json()) as DiscountWriteInput & { starts_date?: string; starts_time?: string; expires_date?: string; expires_time?: string; archive?: boolean };
    const actor = await getActionActor();
    if (body.archive) {
      const code = await archiveDiscountCode(params.id, actor?.name || actor?.id || null);
      return noStore({ ok: true, code });
    }
    const starts = body.starts_date ? istLocalToUtcIso(body.starts_date, body.starts_time || "00:00") : body.starts_at || null;
    const expires = body.expires_date ? istLocalToUtcIso(body.expires_date, body.expires_time || "23:59") : body.expires_at || null;
    const code = await updateDiscountCode(params.id, { ...body, starts_at: starts, expires_at: expires }, actor?.name || actor?.id || null);
    return noStore({ ok: true, code });
  } catch (error) {
    return noStore({ ok: false, error: (error as Error).message }, 400);
  }
}
