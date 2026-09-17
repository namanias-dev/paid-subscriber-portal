import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { revalidateTag } from "next/cache";
import { STORE_CACHE_TAG } from "@/lib/store/catalogue";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data } = await db
    .from("store_products")
    .select("id,sku,slug,name,selling_price_paise,on_hand,reserved,is_active,kind")
    .order("position", { ascending: true });
  return NextResponse.json({ ok: true, products: data || [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const body = await req.json();
  const { data, error } = await db
    .from("store_products")
    .insert({
      sku: body.sku,
      slug: body.slug,
      name: body.name,
      category_id: body.category_id || null,
      kind: body.kind || "single",
      mrp_paise: Number(body.mrp_paise),
      selling_price_paise: Number(body.selling_price_paise),
      on_hand: Number(body.on_hand || 0),
      dispatch_days: Number(body.dispatch_days || 2),
      short_description: body.short_description || null,
      is_active: !!body.is_active,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  revalidateTag(STORE_CACHE_TAG);
  return NextResponse.json({ ok: true, id: data.id }, { headers: { "Cache-Control": "no-store" } });
}
