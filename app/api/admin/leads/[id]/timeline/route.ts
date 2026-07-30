import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { phoneKeyFromRaw } from "@/lib/marketing/legacyLeadMatch";
import { formatStaffVerdictLabel } from "@/lib/leadBehaviourStatus";
import { leadStatusLabel } from "@/lib/leadStatus";

export const dynamic = "force-dynamic";

export type LeadTimelineOrigin = "system" | "staff" | "payment" | "registration" | "enrollment" | "historical" | "unknown";

export interface LeadTimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  origin: LeadTimelineOrigin;
}

/**
 * Chronological event feed for one lead — registrations, payments, enrollments,
 * staff verdicts, system verification, and historical legacy matches.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });

    const { data: lead, error: leadErr } = await db
      .from("leads")
      .select(
        "id,phone,phone_key,status,status_origin,status_system_verified_at,manual_status,manual_status_at,manual_status_by,manual_status_by_role,manual_status_note,is_legacy,campaign_clean,campaign,legacy_source_tab,created_at",
      )
      .eq("id", params.id)
      .maybeSingle();

    if (leadErr) throw new Error(leadErr.message);
    if (!lead) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

    const phoneKey =
      (typeof lead.phone_key === "string" && lead.phone_key.length === 10
        ? lead.phone_key
        : phoneKeyFromRaw(lead.phone)) || "";

    const events: LeadTimelineEvent[] = [];

    // Staff verdict
    if (lead.manual_status && lead.manual_status_at) {
      const label = formatStaffVerdictLabel({
        status: lead.manual_status,
        at: lead.manual_status_at,
        by: lead.manual_status_by,
        byRole: lead.manual_status_by_role,
        note: lead.manual_status_note,
      });
      events.push({
        at: lead.manual_status_at,
        kind: "staff_verdict",
        title: "Staff verdict",
        detail: [label, lead.manual_status_note].filter(Boolean).join(" — ") || lead.manual_status,
        origin: "staff",
      });
    }

    // System verification stamp
    if (lead.status_system_verified_at && lead.status) {
      events.push({
        at: lead.status_system_verified_at,
        kind: "system_verified",
        title: "System verified status",
        detail: leadStatusLabel(lead.status),
        origin: "system",
      });
    }

    // Lead created
    if (lead.created_at) {
      events.push({
        at: lead.created_at,
        kind: "lead_created",
        title: lead.is_legacy ? "Legacy lead imported" : "Lead created",
        detail: lead.is_legacy
          ? [lead.campaign_clean || lead.campaign || lead.legacy_source_tab, lead.status]
              .filter(Boolean)
              .join(" · ") || null
          : leadStatusLabel(lead.status),
        origin: lead.is_legacy ? "historical" : "unknown",
      });
    }

    if (phoneKey) {
      const [regs, pays, ens, legacy] = await Promise.all([
        db
          .from("webinar_registrations")
          .select("id,webinar_id,created_at,name")
          .eq("phone_key", phoneKey)
          .order("created_at", { ascending: true }),
        db
          .from("payments")
          .select("id,status,amount,item_type,item_name,payment_kind,created_at,reference_no")
          .eq("phone_key", phoneKey)
          .is("deleted_at", null)
          .order("created_at", { ascending: true }),
        db
          .from("course_enrollments")
          .select("id,status,course_title,amount_paid,created_at,updated_at")
          .eq("phone_key", phoneKey)
          .order("created_at", { ascending: true }),
        db
          .from("leads")
          .select("id,status,campaign_clean,campaign,legacy_source_tab,created_at,first_seen_at")
          .eq("phone_key", phoneKey)
          .eq("is_legacy", true)
          .neq("id", params.id)
          .limit(5),
      ]);

      const webinarIds = [...new Set((regs.data || []).map((r) => r.webinar_id).filter(Boolean))] as string[];
      const titleById = new Map<string, string>();
      if (webinarIds.length) {
        const { data: ws } = await db.from("webinars").select("id,title").in("id", webinarIds);
        for (const w of ws || []) titleById.set(w.id, w.title || "Webinar");
      }

      for (const r of regs.data || []) {
        const title = r.webinar_id ? titleById.get(r.webinar_id) : null;
        events.push({
          at: r.created_at || lead.created_at,
          kind: "webinar_registration",
          title: "Webinar registration",
          detail: title || null,
          origin: "registration",
        });
      }

      for (const p of pays.data || []) {
        const st = (p.status || "").toUpperCase();
        const kind = (p.payment_kind || "").toLowerCase();
        const amt = Number(p.amount || 0);
        const item = p.item_name || p.item_type || "payment";
        let title = "Payment";
        if (st === "FAILED" || st === "ABANDONED" || st === "REFUNDED") title = `Payment ${st.toLowerCase()}`;
        else if (st === "PAID" || st === "CAPTURED") {
          if (kind === "seat") title = "Seat payment";
          else if (kind === "installment") title = "Installment payment";
          else if (p.item_type === "webinar") title = "Webinar payment";
          else title = "Payment paid";
        } else {
          title = `Payment ${st || "pending"}`;
        }
        events.push({
          at: p.created_at || lead.created_at,
          kind: "payment",
          title,
          detail: [item, amt > 0 ? `₹${amt.toLocaleString("en-IN")}` : null, p.reference_no]
            .filter(Boolean)
            .join(" · "),
          origin: "payment",
        });
      }

      for (const e of ens.data || []) {
        const at = e.updated_at || e.created_at || lead.created_at;
        events.push({
          at,
          kind: "enrollment",
          title: `Enrollment · ${e.status || "unknown"}`,
          detail: [e.course_title, e.amount_paid != null ? `paid ₹${Number(e.amount_paid).toLocaleString("en-IN")}` : null]
            .filter(Boolean)
            .join(" · "),
          origin: "enrollment",
        });
      }

      for (const leg of legacy.data || []) {
        const at = leg.first_seen_at || leg.created_at;
        if (!at) continue;
        events.push({
          at,
          kind: "legacy_match",
          title: "HISTORICAL · Legacy match",
          detail: [
            leg.campaign_clean || leg.campaign || leg.legacy_source_tab,
            leg.status,
          ]
            .filter(Boolean)
            .join(" · "),
          origin: "historical",
        });
      }
    }

    // Deduplicate near-identical events (same at+kind+title), keep order oldest→newest
    const seen = new Set<string>();
    const sorted = events
      .filter((e) => e.at)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .filter((e) => {
        const key = `${e.at}|${e.kind}|${e.title}|${e.detail || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return NextResponse.json({ ok: true, events: sorted });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to load timeline." },
      { status: 500 },
    );
  }
}
