import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import { getSettings, updateSettings } from "@/lib/sms/store";
import { envStatus } from "@/lib/sms/config";
import type { SmsSettings } from "@/lib/sms/types";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const settings = await getSettings();
  return NextResponse.json({ ok: true, settings, env: envStatus() });
}

export async function PATCH(req: Request) {
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Super Admin only" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Partial<SmsSettings>;
  const patch: Partial<SmsSettings> = {};
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.dailyCap !== undefined) patch.dailyCap = Math.max(0, Number(body.dailyCap) || 0);
  if (body.perMobileDailyCap !== undefined) patch.perMobileDailyCap = Math.max(0, Number(body.perMobileDailyCap) || 0);
  if (typeof body.windowStart === "string") patch.windowStart = body.windowStart;
  if (typeof body.windowEnd === "string") patch.windowEnd = body.windowEnd;
  if (body.t19OffsetMinutes !== undefined) patch.t19OffsetMinutes = Math.max(0, Number(body.t19OffsetMinutes) || 0);
  if (body.t19FallbackAllRegistered !== undefined) patch.t19FallbackAllRegistered = !!body.t19FallbackAllRegistered;
  const settings = await updateSettings(patch, await currentAdminId());
  return NextResponse.json({ ok: true, settings });
}
