import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { resolveTimeframe, type TimeframeValue } from "@/lib/dates";
import {
  PHONE_AUDIENCES,
  countAllPhoneAudiences,
  resolvePhoneAudience,
  formatPhonesForClipboard,
  type PhoneAudienceId,
} from "@/lib/adminPhoneAudiences";
import { logAdminActivity } from "@/lib/adminActivity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COPY_CAP = 2000;

function timeframeFromBody(body: Record<string, unknown>): { fromMs: number; toMs: number; label: string } {
  const mode = String(body.mode || "30d");
  if (mode === "year") {
    const y = new Date().toLocaleString("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" });
    const tf: TimeframeValue = { mode: "range", from: `${y}-01-01`, to: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) };
    const { fromMs, toMs } = resolveTimeframe(tf);
    // range is inclusive end-of-day; resolveTimeframe for range already exclusive-end next day
    return { fromMs, toMs, label: "year" };
  }
  if (mode === "custom" || mode === "range") {
    const tf: TimeframeValue = { mode: "range", from: String(body.from || ""), to: String(body.to || "") };
    const { fromMs, toMs } = resolveTimeframe(tf);
    return { fromMs, toMs, label: "custom" };
  }
  const tf: TimeframeValue = { mode: mode as TimeframeValue["mode"] };
  const { fromMs, toMs } = resolveTimeframe(tf);
  return { fromMs, toMs, label: mode };
}

/** GET — audience definitions (static). */
export async function GET() {
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, audiences: PHONE_AUDIENCES, copyCap: COPY_CAP });
}

/**
 * POST actions:
 *  - counts: { action:"counts", mode, from?, to? } → all 8 counts
 *  - list:   { action:"list", audience, mode, ... } → preview + full phones (capped)
 *  - copied: { action:"copied", audience, count, mode } → activity log only
 */
export async function POST(req: Request) {
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "counts");
  const { fromMs, toMs, label } = timeframeFromBody(body);

  if (action === "counts") {
    const counts = await countAllPhoneAudiences(fromMs, toMs);
    return NextResponse.json({ ok: true, counts, timeframe: label, fromMs, toMs });
  }

  if (action === "list") {
    const audience = String(body.audience || "") as PhoneAudienceId;
    if (!PHONE_AUDIENCES.some((a) => a.id === audience)) {
      return NextResponse.json({ ok: false, error: "Unknown audience." }, { status: 400 });
    }
    const people = await resolvePhoneAudience(audience, fromMs, toMs);
    const total = people.length;
    if (total > COPY_CAP) {
      return NextResponse.json({
        ok: true,
        capped: true,
        total,
        copyCap: COPY_CAP,
        preview: people.slice(0, 10),
        phones: [] as string[],
        clipboardText: "",
      });
    }
    const phones = people.map((p) => p.phone);
    return NextResponse.json({
      ok: true,
      capped: false,
      total,
      copyCap: COPY_CAP,
      preview: people.slice(0, 10),
      phones,
      clipboardText: formatPhonesForClipboard(phones),
    });
  }

  if (action === "copied") {
    const actor = await getActionActor();
    const audience = String(body.audience || "");
    const meta = PHONE_AUDIENCES.find((a) => a.id === audience);
    await logAdminActivity({
      actor,
      action: "phone_audience_copied",
      entityType: "audience",
      entityId: audience,
      metadata: {
        audience_name: meta?.label || audience,
        timeframe: label,
        unique_count: Number(body.count) || 0,
      },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
