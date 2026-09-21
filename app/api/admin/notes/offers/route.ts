import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import {
  createStoreOffer,
  listStoreOffers,
  type OfferWriteInput,
} from "@/lib/store/offers";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  try {
    const offers = await listStoreOffers();
    const db = storeDb();
    const { data: products } = db
      ? await db
          .from("store_products")
          .select("id,name,sku,kind,category_id,is_active")
          .is("archived_at", null)
          .order("name")
      : { data: [] };
    const { data: categories } = db
      ? await db.from("store_categories").select("id,name,slug").eq("is_active", true).order("position")
      : { data: [] };
    return noStore({
      ok: true,
      server_now: new Date().toISOString(),
      offers,
      products: products || [],
      categories: categories || [],
    });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 500);
  }
}

export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  try {
    const body = (await req.json()) as OfferWriteInput;
    const offer = await createStoreOffer(body);
    return noStore({ ok: true, offer });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 400);
  }
}
