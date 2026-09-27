import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { clientIp, storeRateLimited } from "@/lib/store/rateLimit";
import { readCheckoutLeadDraft, saveCheckoutLead } from "@/lib/store/checkoutLeads";
import { normalizeIndianMobile } from "@/lib/store/checkoutLeadLogic";
import { getBuyerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const dark = await requireLiveStore();
  if (dark) return dark;
  const draft = await readCheckoutLeadDraft();
  let prefill: { name: string; phone: string } | null = null;
  if (!draft) {
    try {
      const session = await getBuyerSession();
      const phone = normalizeIndianMobile(session?.phone);
      if (session && phone) prefill = { name: session.name || "", phone };
    } catch { /* prefill is optional */ }
  }
  return noStoreJson({ ok: true, draft, prefill });
}

export async function POST(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  if (await storeRateLimited(`notes-checkout-lead:${clientIp(req)}`, 30, 600)) {
    return noStoreJson({ ok: true, skipped: "rate" });
  }
  const body = await req.json().catch(() => ({}));
  await saveCheckoutLead({
    name: typeof body.name === "string" ? body.name : null,
    phone: typeof body.phone === "string" ? body.phone : null,
    email: typeof body.email === "string" ? body.email : null,
    marketingConsent: body.marketing_consent === true,
    address: body.address && typeof body.address === "object" ? body.address : null,
  });
  return noStoreJson({ ok: true });
}
