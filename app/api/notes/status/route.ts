import { noStoreJson } from "@/lib/store/http";
import { storeEnabled } from "@/lib/store/flags";

export const dynamic = "force-dynamic";

/** Public, cache-busting flag check. Used by the cart badge on ISR pages. */
export async function GET() {
  const enabled = await storeEnabled();
  return noStoreJson({ ok: true, enabled });
}
