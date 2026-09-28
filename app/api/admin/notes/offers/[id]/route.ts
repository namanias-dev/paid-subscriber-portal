import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import {
  duplicateStoreOffer,
  getStoreOfferById,
  setOfferEnabled,
  updateStoreOffer,
  type OfferWriteInput,
} from "@/lib/store/offers";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  const offer = await getStoreOfferById(params.id);
  if (!offer) return noStore({ ok: false, error: "not found" }, 404);
  return noStore({ ok: true, offer, server_now: new Date().toISOString() });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_catalogue"))) {
    return noStore({ ok: false, error: "Forbidden" }, 403);
  }
  try {
    const body = (await req.json()) as OfferWriteInput & { duplicate?: boolean; enabled_only?: boolean };
    if (body.duplicate) {
      const offer = await duplicateStoreOffer(params.id);
      return noStore({ ok: true, offer });
    }
    if (body.enabled_only) {
      const offer = await setOfferEnabled(params.id, !!body.enabled);
      return noStore({ ok: true, offer });
    }
    const offer = await updateStoreOffer(params.id, body);
    return noStore({ ok: true, offer });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 400);
  }
}
