import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { revalidateTag } from "next/cache";
import { STORE_CACHE_TAG } from "@/lib/store/catalogue";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function guard() {
  return requirePermission("store_manage_catalogue");
}

/** GET ?bundle_id= — a bundle's components + selectable single products. */
export async function GET(req: Request) {
  if (!(await guard())) return noStore({ ok: false, error: "Forbidden" }, 403);
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const bundleId = new URL(req.url).searchParams.get("bundle_id") || "";
  if (!bundleId) return noStore({ ok: false, error: "bundle_id required" }, 400);

  const { data: links } = await db
    .from("store_bundle_items")
    .select("component_id,qty,position")
    .eq("bundle_id", bundleId)
    .order("position", { ascending: true });
  const compIds = (links || []).map((l) => l.component_id);

  const { data: products } = await db
    .from("store_products")
    .select("id,name,sku,subject,selling_price_paise,availability_mode,kind,is_active")
    .eq("kind", "single")
    .order("name", { ascending: true });

  const byId = new Map((products || []).map((p) => [p.id, p]));
  const components = (links || []).map((l) => {
    const p = byId.get(l.component_id);
    return {
      component_id: l.component_id,
      qty: Number(l.qty),
      position: l.position,
      name: p?.name || "Unknown",
      sku: p?.sku || "",
      selling_price_paise: p?.selling_price_paise ?? 0,
      availability_mode: p?.availability_mode ?? null,
    };
  });
  const componentTotal = components.reduce((s, c) => s + c.selling_price_paise * c.qty, 0);
  const candidates = (products || []).filter((p) => !compIds.includes(p.id) && p.is_active);

  return noStore({ ok: true, components, component_total_paise: componentTotal, candidates });
}

/** POST { bundle_id, component_id, qty } — add a component (or bump qty). */
export async function POST(req: Request) {
  if (!(await guard())) return noStore({ ok: false, error: "Forbidden" }, 403);
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const body = await req.json().catch(() => null);
  const bundleId = String(body?.bundle_id || "").trim();
  const componentId = String(body?.component_id || "").trim();
  const qty = Math.max(1, Math.round(Number(body?.qty || 1)));
  if (!bundleId || !componentId) return noStore({ ok: false, error: "bundle_id and component_id required" }, 400);
  if (bundleId === componentId) return noStore({ ok: false, error: "a bundle cannot contain itself" }, 400);

  const { data: bundle } = await db.from("store_products").select("id,kind").eq("id", bundleId).maybeSingle();
  if (!bundle || bundle.kind !== "bundle") return noStore({ ok: false, error: "not a bundle" }, 400);
  const { data: comp } = await db.from("store_products").select("id,kind").eq("id", componentId).maybeSingle();
  if (!comp || comp.kind !== "single") return noStore({ ok: false, error: "components must be single products" }, 400);

  const { data: last } = await db
    .from("store_bundle_items")
    .select("position")
    .eq("bundle_id", bundleId)
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? -1) + 1;

  const { error } = await db
    .from("store_bundle_items")
    .upsert({ bundle_id: bundleId, component_id: componentId, qty, position }, { onConflict: "bundle_id,component_id" });
  if (error) return noStore({ ok: false, error: error.message }, 400);
  revalidateTag(STORE_CACHE_TAG);
  return noStore({ ok: true });
}

/** PATCH { bundle_id, action:"reorder", order:[ids] } | { action:"qty", component_id, qty } */
export async function PATCH(req: Request) {
  if (!(await guard())) return noStore({ ok: false, error: "Forbidden" }, 403);
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const body = await req.json().catch(() => null);
  const bundleId = String(body?.bundle_id || "").trim();
  if (!bundleId) return noStore({ ok: false, error: "bundle_id required" }, 400);
  try {
    if (body.action === "reorder") {
      let pos = 0;
      for (const id of (body.order || []).map(String)) {
        await db.from("store_bundle_items").update({ position: pos++ }).eq("bundle_id", bundleId).eq("component_id", id);
      }
    } else if (body.action === "qty") {
      const qty = Math.max(1, Math.round(Number(body.qty || 1)));
      await db.from("store_bundle_items").update({ qty }).eq("bundle_id", bundleId).eq("component_id", String(body.component_id));
    } else {
      return noStore({ ok: false, error: "unknown action" }, 400);
    }
    revalidateTag(STORE_CACHE_TAG);
    return noStore({ ok: true });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 400);
  }
}

/** DELETE ?bundle_id=&component_id= — remove a component. */
export async function DELETE(req: Request) {
  if (!(await guard())) return noStore({ ok: false, error: "Forbidden" }, 403);
  const db = storeDb();
  if (!db) return noStore({ ok: false, error: "unavailable" }, 503);
  const url = new URL(req.url);
  const bundleId = url.searchParams.get("bundle_id") || "";
  const componentId = url.searchParams.get("component_id") || "";
  if (!bundleId || !componentId) return noStore({ ok: false, error: "bundle_id and component_id required" }, 400);
  await db.from("store_bundle_items").delete().eq("bundle_id", bundleId).eq("component_id", componentId);
  revalidateTag(STORE_CACHE_TAG);
  return noStore({ ok: true });
}
