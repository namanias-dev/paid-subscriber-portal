import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { listLogsByCampaign } from "@/lib/sms/store";
import { pollDeliveryStatuses } from "@/lib/sms/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Live per-recipient status for one send (campaign). Pulls fresh DLR from the
 * gateway (unless ?poll=0) so SENT rows settle to DELIVERED / FAILED, then
 * returns every recipient's current status + running totals. The UI polls this
 * (~5s) while the results panel is open, and stops once everything settles.
 */
export async function GET(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ ok: false, error: "Missing campaign id" }, { status: 400 });

  let logs = await listLogsByCampaign(id);

  // Refresh delivery for this campaign's message ids (skippable with poll=0).
  if (url.searchParams.get("poll") !== "0") {
    const messageIds = [...new Set(logs.map((l) => l.gateway_message_id).filter((x): x is string => !!x))];
    if (messageIds.length) {
      try { await pollDeliveryStatuses({ messageIds }); logs = await listLogsByCampaign(id); } catch { /* non-fatal */ }
    }
  }

  const totals = { queued: 0, sent: 0, delivered: 0, failed: 0, unknown: 0 };
  const recipients = logs.map((l) => {
    const s = l.status;
    if (s === "QUEUED") totals.queued++;
    else if (s === "SENT") totals.sent++;
    else if (s === "DELIVERED") totals.delivered++;
    else if (s === "FAILED") totals.failed++;
    else totals.unknown++;
    return { mobile: l.normalized_mobile, name: l.student_name, status: s, error: l.error_message };
  });

  // "Settled" = nothing left in a transient state (QUEUED/SENT), so the UI can stop polling.
  const settled = totals.queued === 0 && totals.sent === 0;
  return NextResponse.json({ ok: true, campaignId: id, total: recipients.length, totals, settled, recipients });
}
