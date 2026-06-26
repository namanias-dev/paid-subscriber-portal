import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import {
  getWebinars,
  getWebinarRegistrationsByWebinar,
  getWebinarPaymentStatusesForSlug,
} from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/** Registrant status, clearly labelled. Only "paid"/"free" are confirmed. */
type RegStatus = "paid" | "pending" | "failed" | "unpaid" | "free";

/**
 * Admin registrant list for a webinar, each row labelled Paid / Pending / Failed
 * / Unpaid (paid webinars) or Free (free webinars). Confirmed = paid + free only;
 * pending/failed/unpaid never count toward the confirmed total.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const webinar = (await getWebinars()).find((w) => w.id === params.id);
    if (!webinar) return NextResponse.json({ ok: false, error: "Webinar not found" }, { status: 404 });

    const isFree = (webinar.price ?? 0) <= 0;
    const [regs, payByPhone] = await Promise.all([
      getWebinarRegistrationsByWebinar(webinar.id),
      isFree ? Promise.resolve(new Map()) : getWebinarPaymentStatusesForSlug(webinar.slug),
    ]);

    const registrants = regs.map((r) => {
      let status: RegStatus;
      if (isFree) status = "free";
      else {
        const pay = payByPhone.get((r.phone || "").trim());
        status = pay === "PAID" ? "paid" : pay === "PENDING" ? "pending" : pay === "FAILED" ? "failed" : "unpaid";
      }
      return { id: r.id, name: r.name, phone: r.phone, created_at: r.created_at, attended: r.attended, status };
    });

    const counts = {
      total: registrants.length,
      confirmed: registrants.filter((r) => r.status === "paid" || r.status === "free").length,
      paid: registrants.filter((r) => r.status === "paid").length,
      pending: registrants.filter((r) => r.status === "pending").length,
      failed: registrants.filter((r) => r.status === "failed").length,
      unpaid: registrants.filter((r) => r.status === "unpaid").length,
    };

    return NextResponse.json({
      ok: true,
      webinar: { id: webinar.id, title: webinar.title, slug: webinar.slug, price: webinar.price, isFree },
      counts,
      registrants,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load registrations." }, { status: 500 });
  }
}
