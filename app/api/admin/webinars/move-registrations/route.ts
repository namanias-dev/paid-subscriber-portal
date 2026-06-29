import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import {
  previewMoveRegistrations,
  applyMoveRegistrations,
} from "@/lib/dataProvider";
import { fireAutoSms } from "@/lib/sms/dispatch";
import { TRIGGERS } from "@/lib/sms/templates";
import { formatISTDateTime } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * FEATURE 3 — Move late registrations between webinars.
 *  POST { sourceId, targetId, cutoffISO?, includeStatuses?, apply?, reason? }
 *  - apply !== true  → DRY RUN: returns counts + per-status + candidate list.
 *  - apply === true  → reassigns included registrants/payments to the target
 *    (no deletes, no duplicate revenue, no re-charge, no duplicate students),
 *    audit-logs the move, and fires ONE idempotent notification per student.
 */
export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_webinars"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sourceId = String(body.sourceId || "").trim();
    const targetId = String(body.targetId || "").trim();
    if (!sourceId || !targetId) {
      return NextResponse.json({ ok: false, error: "Source and target webinars are required." }, { status: 400 });
    }
    const cutoffISO = typeof body.cutoffISO === "string" && body.cutoffISO.trim() ? body.cutoffISO.trim() : null;
    const includeStatuses = Array.isArray(body.includeStatuses)
      ? (body.includeStatuses as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    const apply = body.apply === true;
    const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
    const actor = await getActionActor();

    if (!apply) {
      const dry = await previewMoveRegistrations({ sourceId, targetId, cutoffISO, includeStatuses, actor: actor?.id ?? null });
      if (!dry.ok) return NextResponse.json({ ok: false, error: dry.error }, { status: 400 });
      return NextResponse.json({
        ok: true,
        mode: "dry-run",
        source: dry.source ? { id: dry.source.id, title: dry.source.title } : null,
        target: dry.target ? { id: dry.target.id, title: dry.target.title } : null,
        preview: dry.preview,
      });
    }

    const res = await applyMoveRegistrations({ sourceId, targetId, cutoffISO, includeStatuses, reason, actor: actor?.id ?? null });
    if (!res.ok || !res.target) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

    // FEATURE 5 — notify each moved student exactly once (idempotent via the
    // dedupe key keyed to the registration). No-ops unless a Super Admin has
    // enabled the webinar_moved auto-rule; never spams or throws.
    const whenLabel = formatISTDateTime(res.target.datetime);
    for (const m of res.moved) {
      fireAutoSms({
        trigger: TRIGGERS.webinar_moved,
        phone: m.phone,
        name: m.name,
        vars: { item_short: res.target.title, date: whenLabel },
        entity: { webinar_id: res.target.id, registration_id: m.registration_id },
        entityId: m.registration_id,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "apply",
      movedCount: res.moved.length,
      target: { id: res.target.id, title: res.target.title, datetime: res.target.datetime },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to move registrations.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
