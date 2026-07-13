import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getStudents, getLeaderboardSettings, updateLeaderboardSettings } from "@/lib/dataProvider";
import { clampReliabilityC, normalizeLeaderboardSettings } from "@/lib/leaderboardConfig";

export const dynamic = "force-dynamic";

/**
 * GLOBAL leaderboard exclude list + tuned Reliability C (single source of truth).
 *
 * READ  — any leaderboard admin (manage_students_leads). Also returns a light
 *         {id,name,phone} people list to power the searchable multi-select and
 *         to resolve stored ids → chips.
 * WRITE — admins with manage_settings only (RBAC-gated). Students can neither
 *         see nor change this; they'd only ever see the already-filtered board.
 *
 * DISPLAY-scope only: this never deletes/deactivates accounts, enrollments or
 * quiz data — it only removes users from ranking + aggregates in every view.
 */
export async function GET() {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const [settings, students, canEdit] = await Promise.all([
      getLeaderboardSettings(),
      getStudents(),
      requirePermission("manage_settings"),
    ]);
    const people = students
      .map((s) => ({ id: s.id, name: s.name, phone: s.phone || null }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return NextResponse.json({ ok: true, ...settings, canEdit, people });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load exclusions.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    if (!(await requirePermission("manage_settings"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const body = (await req.json().catch(() => ({}))) as { excludedStudentIds?: unknown; reliabilityC?: unknown };
    const current = await getLeaderboardSettings();

    // Partial update: only overwrite fields the caller actually provided.
    const next = normalizeLeaderboardSettings({
      excludedStudentIds: Array.isArray(body.excludedStudentIds) ? body.excludedStudentIds : current.excludedStudentIds,
      reliabilityC: typeof body.reliabilityC === "number" ? clampReliabilityC(body.reliabilityC) : current.reliabilityC,
    });

    const saved = await updateLeaderboardSettings(next);
    return NextResponse.json({ ok: true, ...saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save exclusions.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
