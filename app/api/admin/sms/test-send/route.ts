import { NextResponse } from "next/server";
import { requirePermission, currentAdminId } from "@/lib/adminGuard";
import { sendSms } from "@/lib/sms/service";
import { WORST_SAMPLE } from "@/lib/sms/templates";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Test-send-to-self: fire ONE message of the chosen template to a single number
 * (usually the marketer's own) BEFORE the real blast, so they can eyeball the
 * exact formatting on a handset. Sample values fill any variable slots (login_url
 * still resolves to the real portal link) so it always renders. Goes through the
 * full sendSms pipeline — every safeguard (kill-switch, DLT gate, opt-out, caps)
 * still applies; the 30-min re-send guard is overridden so repeated tests work.
 */
export async function POST(req: Request) {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const mobile = typeof body.mobile === "string" ? body.mobile : "";
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  if (!mobile.trim() || !templateId) return NextResponse.json({ ok: false, error: "Missing mobile or template" }, { status: 400 });

  // Sample fill for readability; drop login_url so the REAL (store/config) link is used.
  const variables: Record<string, string> = { ...WORST_SAMPLE };
  delete variables.login_url;

  const res = await sendSms({
    mobile,
    templateId,
    variables,
    sentBy: { userId: await currentAdminId(), type: "ADMIN" },
    audienceType: "test",
    triggerEvent: "test_send",
    allowRecentOverride: true,
  });

  if (res.ok) return NextResponse.json({ ok: true, status: res.status });
  return NextResponse.json({ ok: false, error: res.error || res.skipped || "Test send failed", skipped: res.skipped });
}
