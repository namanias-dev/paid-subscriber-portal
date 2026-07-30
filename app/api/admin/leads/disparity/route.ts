import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  BEHAVIOUR_LADDER,
  NEGATIVE_MANUAL_STATUSES,
  isBehaviourStage,
} from "@/lib/leadBehaviourStatus";
import { LEAD_STATUSES, leadStatusLabel } from "@/lib/leadStatus";

export const dynamic = "force-dynamic";

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  status: string | null;
  status_origin: string | null;
  status_system_verified_at: string | null;
  manual_status: string | null;
  manual_status_at: string | null;
  manual_status_by: string | null;
  manual_status_by_role: string | null;
};

function dayGap(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

const NEGATIVE = new Set<string>(NEGATIVE_MANUAL_STATUSES);
const BEHAVIOUR = new Set<string>(BEHAVIOUR_LADDER);

/** Positive staff judgements used for the reverse list (optimistic, no behaviour). */
const POSITIVE_MANUAL = new Set<string>(
  LEAD_STATUSES.filter(
    (s) =>
      !NEGATIVE.has(s) &&
      s !== "Not Called" &&
      s !== "Not Replied" &&
      !isBehaviourStage(s),
  ),
);

/**
 * Status disparity report: where staff manual verdict diverges from
 * behaviour-driven `leads.status`.
 */
export async function GET() {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Database unavailable." }, { status: 503 });

    // Page through unmerged leads with a manual verdict.
    const rows: LeadRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db
        .from("leads")
        .select(
          "id,name,phone,status,status_origin,status_system_verified_at,manual_status,manual_status_at,manual_status_by,manual_status_by_role",
        )
        .is("merged_into", null)
        .not("manual_status", "is", null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      rows.push(...(data as LeadRow[]));
      if (data.length < pageSize) break;
    }

    // Cross-tab: manual_status × status
    const crossMap = new Map<string, number>();
    for (const r of rows) {
      const m = r.manual_status || "—";
      const s = r.status || "—";
      const key = `${m}\t${s}`;
      crossMap.set(key, (crossMap.get(key) || 0) + 1);
    }
    const crossTab = [...crossMap.entries()]
      .map(([key, count]) => {
        const [manual_status, status] = key.split("\t");
        return {
          manual_status,
          manual_label: leadStatusLabel(manual_status),
          status,
          status_label: leadStatusLabel(status),
          count,
        };
      })
      .sort((a, b) => b.count - a.count || a.manual_status.localeCompare(b.manual_status));

    // Negative then converted: staff said no, behaviour says paid/registered.
    const negativeThenConverted = rows
      .filter((r) => r.manual_status && NEGATIVE.has(r.manual_status) && r.status && BEHAVIOUR.has(r.status))
      .map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        manual_status: r.manual_status,
        status: r.status,
        manual_status_by: r.manual_status_by,
        manual_status_at: r.manual_status_at,
        behaviour_at: r.status_system_verified_at,
        gap_days: dayGap(r.manual_status_at, r.status_system_verified_at),
      }))
      .sort((a, b) => (b.manual_status_at || "").localeCompare(a.manual_status_at || ""));

    // Per-staff rates: of their manual verdicts, how many later flipped to behaviour.
    const byStaff = new Map<
      string,
      { by: string; byRole: string | null; totalManual: number; flippedToBehaviour: number }
    >();
    for (const r of rows) {
      const by = (r.manual_status_by || "").trim() || "(unknown)";
      const cur = byStaff.get(by) || {
        by,
        byRole: r.manual_status_by_role,
        totalManual: 0,
        flippedToBehaviour: 0,
      };
      cur.totalManual += 1;
      if (r.status && BEHAVIOUR.has(r.status) && r.manual_status !== r.status) {
        cur.flippedToBehaviour += 1;
      }
      if (!cur.byRole && r.manual_status_by_role) cur.byRole = r.manual_status_by_role;
      byStaff.set(by, cur);
    }
    const perStaff = [...byStaff.values()]
      .map((s) => ({
        ...s,
        rate: s.totalManual > 0 ? s.flippedToBehaviour / s.totalManual : 0,
        denominator: s.totalManual,
      }))
      .sort((a, b) => b.flippedToBehaviour - a.flippedToBehaviour || b.totalManual - a.totalManual);

    // Reverse: positive manual, no behaviour on displayed status.
    const reverse = rows
      .filter(
        (r) =>
          r.manual_status &&
          POSITIVE_MANUAL.has(r.manual_status) &&
          !(r.status && BEHAVIOUR.has(r.status)),
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        manual_status: r.manual_status,
        status: r.status,
        manual_status_by: r.manual_status_by,
        manual_status_at: r.manual_status_at,
      }))
      .sort((a, b) => (b.manual_status_at || "").localeCompare(a.manual_status_at || ""));

    return NextResponse.json({
      ok: true,
      report: {
        totalWithManual: rows.length,
        crossTab,
        negativeThenConverted,
        perStaff,
        reverse,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to build disparity report." },
      { status: 500 },
    );
  }
}
