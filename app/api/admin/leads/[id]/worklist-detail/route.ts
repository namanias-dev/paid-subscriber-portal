import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getLeadAudit, getLeadNotes } from "@/lib/legacy-crm/writes";

export const dynamic = "force-dynamic";

/**
 * PHASE 2 — everything the lead detail drawer renders, in one round trip.
 *
 * Identity · full provenance · notes timeline · contact history · audit trail.
 *
 * WHY THE `attribution` JSONB IS READ HERE AND NOWHERE ELSE
 * --------------------------------------------------------
 * The column averages ~892 bytes across 179k rows and bulk-reading it on a
 * LIST path cost ~13.2 s in deTOAST alone, which is why the worklist projects
 * explicit scalars instead. On the SINGLE-LEAD path that cost is one row, and
 * the first-touch provenance the drawer must show honestly lives nowhere else.
 * So: never on a list, always here.
 *
 * `lead_legacy_touches` is the side table the JSONB slimming moved the touch
 * history into. It is read alongside, keyed by lead_id.
 */

const PROVENANCE_COLUMNS = [
  "id",
  "name",
  "phone",
  "email",
  "city",
  "state",
  "source",
  "campaign",
  "campaign_clean",
  "channel",
  "status",
  "created_at",
  "updated_at",
  "first_seen_at",
  "import_source",
  "import_batch",
  "external_lead_id",
  "legacy_source_tab",
  "legacy_call_status",
  "legacy_call_status_raw",
  "is_legacy",
  "cohort",
  "promoted_at",
  "promoted_by",
  "assigned_to",
  "counsellor",
  "worklist_queue",
  "work_status",
  "work_status_at",
  "work_status_by",
  "follow_up_at",
  "last_worked_at",
  "last_contacted_at",
  "contact_attempt_count",
  "consent_status",
  "consent_source",
  "consent_captured_at",
  "dnd_status",
  "suppression_reason",
  "opted_out_at",
  "merged_into",
  "merged_count",
  "attribution",
].join(",");

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const leadId = ctx.params.id;
  if (!leadId) return NextResponse.json({ ok: false, error: "Missing lead id." }, { status: 400 });

  try {
    const db = getSupabaseAdmin();
    if (!db) throw new Error("Supabase admin client unavailable");

    const [leadRes, touchesRes, notes, audit, activitiesRes] = await Promise.all([
      db.from("leads").select(PROVENANCE_COLUMNS).eq("id", leadId).limit(1),
      db.from("lead_legacy_touches").select("lead_id, touches, touch_count, moved_at").eq("lead_id", leadId).limit(1),
      getLeadNotes(leadId),
      getLeadAudit(leadId),
      db
        .from("lead_activities")
        .select("id, lead_id, type, note, counsellor, timestamp")
        .eq("lead_id", leadId)
        .order("timestamp", { ascending: false })
        .limit(100),
    ]);

    if (leadRes.error) throw new Error(leadRes.error.message);
    const lead = (leadRes.data as unknown as Record<string, unknown>[] | null)?.[0];
    if (!lead) return NextResponse.json({ ok: false, error: "Lead not found." }, { status: 404 });

    const touchRow = (touchesRes.data as { touches: unknown; touch_count: number; moved_at: string }[] | null)?.[0];

    return NextResponse.json({
      ok: true,
      lead,
      // Legacy touch history, moved out of the JSONB by the slimming pass.
      legacyTouches: touchRow?.touches ?? [],
      legacyTouchCount: touchRow?.touch_count ?? 0,
      notes,
      audit,
      activities: activitiesRes.data ?? [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[leads/worklist-detail] read failed:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load the lead.", detail: message },
      { status: 500 },
    );
  }
}
