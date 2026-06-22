import { NextResponse } from "next/server";
import { getBuyerByPhone, getBuyerPurchases, ensureBuyer, rateLimited } from "@/lib/dataProvider";
import { normalizeIndianMobile } from "@/lib/phone";
import { normalizeRefLast } from "@/lib/buyerCode";

export const dynamic = "force-dynamic";

const GENERIC_FAIL =
  "We couldn't verify those details. Please double-check and try again, or contact support.";

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Calendar date (YYYY-MM-DD) in IST for an ISO/date string; null if unparseable. */
function istDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const n = normalizeIndianMobile(body.phone);
    const method = body.method === "date" ? "date" : "ref";
    if (!n.ok || !n.digits10) {
      return NextResponse.json({ ok: false, error: "Enter a valid 10-digit mobile number." }, { status: 400 });
    }
    const phone = n.digits10;
    const ip = clientIp(req);

    if ((await rateLimited(`forgot:${phone}`, 6, 600)) || (await rateLimited(`forgot-ip:${ip}`, 30, 600))) {
      return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
    }

    // Always look up purchases; respond identically whether or not the phone exists
    // (no account-existence leak via message or status).
    const purchases = await getBuyerPurchases(phone);

    let verified = false;
    if (purchases.length) {
      if (method === "ref") {
        const last4 = normalizeRefLast(body.refLast4).slice(-4);
        if (last4.length === 4) {
          verified = purchases.some((p) => normalizeRefLast(p.reference_no).slice(-4) === last4);
        }
      } else {
        const target = istDate(String(body.date || ""));
        if (target) {
          // ±1 day tolerance to absorb timezone / late-night-payment edge cases.
          const allowed = new Set(
            [-1, 0, 1].map((d) => new Date(Date.parse(`${target}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10))
          );
          verified = purchases.some((p) => {
            const c = istDate(p.created_at);
            const t = istDate(p.transaction_date);
            return (c && allowed.has(c)) || (t && allowed.has(t));
          });
        }
      }
    }

    if (!verified) {
      return NextResponse.json({ ok: false, error: GENERIC_FAIL }, { status: 400 });
    }

    // Second factor matched a real purchase — reveal the code (create if missing).
    const buyer = (await getBuyerByPhone(phone)) || (await ensureBuyer(phone));
    if (!buyer) {
      return NextResponse.json({ ok: false, error: GENERIC_FAIL }, { status: 400 });
    }
    return NextResponse.json({ ok: true, loginCode: buyer.login_code, phone });
  } catch {
    return NextResponse.json({ ok: false, error: GENERIC_FAIL }, { status: 400 });
  }
}
