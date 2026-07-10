/**
 * ADMIN AGENT API — full lead profile (360° view).
 * API-enforced auth: requirePermission('manage_ai_agent').
 *
 *  GET ?id=<lead_id>  — the lead + records linked BY PHONE (payments, webinar
 *                       registrations, student record) + a recommended pitch and
 *                       next action derived from live offers + temperature.
 *  PATCH              — update a lead's status / notes (light CRM).
 *
 * Reading lead PII is SENSITIVE → audited to ai_security_audit. Payment amounts
 * are server-sourced; nothing here trusts client input for money.
 */
import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getPaymentsByPhone, isPaidStatus } from "@/lib/dataProvider";
import { getLiveOffers } from "@/lib/ai-agent/offerResolver";
import { recommendCourses, recommendWebinar } from "@/lib/ai-agent/recommendationEngine";
import { writeSecurityAudit, ipFromRequest } from "@/lib/ai-agent/audit";
import { normPhone } from "@/lib/phone";
import type { AiLead } from "@/lib/ai-agent/types";

export const dynamic = "force-dynamic";

function nextActionFor(lead: AiLead, hasPaid: boolean): string {
  if (hasPaid) return "Already a paying student — thank them and offer onboarding help, don't re-pitch.";
  switch (lead.temperature) {
    case "hot":
      return "Call within 24h. Strong buying intent — offer a personalised counselling slot.";
    case "warm":
      return "Send relevant free resources and a gentle nudge; follow up in 2–3 days.";
    default:
      return "Nurture with helpful content. No hard sell yet.";
  }
}

export async function GET(req: Request) {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, profile: null, demo: true });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });

  try {
    const { data: lead } = await db.from("ai_leads").select("*").eq("id", id).maybeSingle();
    if (!lead) return NextResponse.json({ ok: true, profile: null });

    const phone = normPhone((lead as AiLead).phone);
    const [payments, regRes, studentRes, offers] = await Promise.all([
      phone ? getPaymentsByPhone(phone).catch(() => []) : Promise.resolve([]),
      phone
        ? db.from("webinar_registrations").select("id,webinar_id,name,attended,created_at").eq("phone", phone)
        : Promise.resolve({ data: [] }),
      phone
        ? db.from("students").select("id,name,created_at").eq("phone", phone).maybeSingle()
        : Promise.resolve({ data: null }),
      getLiveOffers().catch(() => ({ courses: [], webinars: [], generated_at: "" })),
    ]);

    const hasPaid = (payments as { status?: string }[]).some((p) => isPaidStatus(p.status));

    // Recommended pitch — server-sourced live offers only (never invented).
    const courseRec = recommendCourses(offers, { mode: "either", limit: 1 })[0] || null;
    const webinarRec = recommendWebinar(offers);
    const recommendedPitch = hasPaid
      ? null
      : {
          course: courseRec ? { id: courseRec.id, title: courseRec.title, link: courseRec.link } : null,
          webinar: webinarRec ? { id: webinarRec.id, title: webinarRec.title, link: webinarRec.link } : null,
        };

    const actor = await getActionActor();
    await writeSecurityAudit({
      actor: actor?.id || "admin",
      action: "ai_lead_profile_view",
      targetType: "ai_lead",
      targetId: id,
      ip: ipFromRequest(req),
      meta: { linked_payments: (payments as unknown[]).length },
    });

    return NextResponse.json({
      ok: true,
      profile: {
        lead,
        payments,
        registrations: (regRes as { data?: unknown[] }).data ?? [],
        student: (studentRes as { data?: unknown }).data ?? null,
        hasPaid,
        recommendedPitch,
        nextAction: nextActionFor(lead as AiLead, hasPaid),
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load lead profile." }, { status: 500 });
  }
}

interface PatchBody {
  id?: string;
  status?: string;
  notes?: string;
}

export async function PATCH(req: Request) {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.status === "string" && body.status.trim()) patch.status = body.status.trim().slice(0, 40);
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 1000);

  const actor = await getActionActor();
  try {
    const { data } = await db.from("ai_leads").update(patch).eq("id", id).select("*").maybeSingle();
    await writeSecurityAudit({
      actor: actor?.id || "admin",
      action: "ai_lead_update",
      targetType: "ai_lead",
      targetId: id,
      ip: ipFromRequest(req),
      meta: { fields: Object.keys(patch).filter((k) => k !== "updated_at") },
    });
    return NextResponse.json({ ok: true, lead: data ?? null });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update lead." }, { status: 500 });
  }
}
