import { getPublicActiveOffer } from "@/lib/store/offers";
import { noStoreJson, requireLiveStore } from "@/lib/store/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const dark = await requireLiveStore();
  if (dark) return dark;
  try {
    const offer = await getPublicActiveOffer();
    return noStoreJson({
      ok: true,
      offer,
      server_now: new Date().toISOString(),
    });
  } catch (e) {
    return noStoreJson({ ok: false, error: (e as Error).message }, 500);
  }
}
