import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { logAdminActivity } from "@/lib/adminActivity";
import { STORE_CACHE_TAG } from "@/lib/store/catalogue";
import { getStoreLaunchState, getStoreReadiness, setStoreLaunch } from "@/lib/store/launch";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** GET — current store launch state + pre-launch readiness summary. */
export async function GET() {
  if (!(await requirePermission("store_manage_orders"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const [state, readiness] = await Promise.all([getStoreLaunchState(), getStoreReadiness()]);
  return noStore({ ok: true, state, readiness });
}

/** POST { live: boolean } — take the store live or offline. */
export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_orders"))) return noStore({ ok: false, error: "Forbidden" }, 403);
  const body = (await req.json().catch(() => ({}))) as { live?: unknown };
  if (typeof body.live !== "boolean") {
    return noStore({ ok: false, error: "`live` (boolean) is required." }, 400);
  }
  const live = body.live;

  const before = await getStoreLaunchState();

  // Only block going LIVE on genuine hard blockers; warnings never block.
  if (live) {
    const readiness = await getStoreReadiness();
    if (readiness.blockers.length) {
      return noStore(
        { ok: false, error: "Resolve the blockers before taking the store live.", blockers: readiness.blockers },
        409,
      );
    }
  }

  const actor = await getActionActor();
  const state = await setStoreLaunch(live, { id: actor?.id ?? null, name: actor?.name ?? null });

  // Make the change propagate to the public storefront + nav quickly.
  invalidatePublicStore();

  await logAdminActivity({
    actor,
    action: "notes_store_toggled",
    entityType: "store_flag",
    entityId: "notes_store",
    metadata: { from: before.live ? "live" : "offline", to: state.live ? "live" : "offline" },
  });

  return noStore({ ok: true, state });
}

function invalidatePublicStore() {
  try {
    revalidateTag(STORE_CACHE_TAG);
    // Purge the cached /notes subtree so the gate re-evaluates immediately.
    revalidatePath("/notes", "layout");
  } catch {
    /* best-effort — the 20s flag memo still bounds propagation */
  }
}
