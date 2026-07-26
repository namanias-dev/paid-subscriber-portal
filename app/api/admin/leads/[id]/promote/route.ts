import { NextResponse } from "next/server";
import { getActionActor, requireSuperAdmin } from "@/lib/adminGuard";
import {
  previewPromote,
  promoteLead,
  demoteLead,
  PromoteError,
  DuplicateLiveLeadError,
} from "@/lib/legacy-crm/promote";
import type { WriteActor } from "@/lib/legacy-crm/writes";

export const dynamic = "force-dynamic";

/**
 * PHASE 4a — single-lead promotion into the live pipeline. SUPER ADMIN ONLY.
 *
 * Deliberately a stricter gate than the rest of the worklist. Every other lead
 * action in this program is reachable with `manage_students_leads`, because
 * moving a work status or leaving a note is recoverable and low-stakes.
 * Promotion puts a person into the live sales pipeline, and the live pipeline
 * is wired to the messaging fan-out. The blast radius is different, so the gate
 * is different.
 *
 * NOTHING HERE SENDS. Promotion is an UPDATE on an existing row. The only
 * lead-lifecycle fan-out in the codebase is `fireLeadCreated`, and it is called
 * from exactly two places, both inside `addLead` — the INSERT path
 * (lib/dataProvider.ts:1783, :1787). An UPDATE cannot reach it. See the
 * zero-send guardrail test for the full argument.
 *
 *   GET    ?  -> preview: what would change, and what would block it
 *   POST   {} -> promote
 *   DELETE    -> demote, restoring the exact prior values from the audit
 */

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

/** 409: the request was valid and refused for a reason the operator must see. */
function conflict(error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status: 409 });
}

function fail(e: unknown, fallback: string) {
  if (e instanceof DuplicateLiveLeadError) {
    return conflict(e.message, { duplicateOf: e.existingLeadId, code: "duplicate_live_lead" });
  }
  if (e instanceof PromoteError) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
  }
  return NextResponse.json(
    { ok: false, error: e instanceof Error ? e.message : fallback },
    { status: 500 },
  );
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSuperAdmin())) return unauthorized();
  const { id } = await ctx.params;
  try {
    return NextResponse.json({ ok: true, preview: await previewPromote(id) });
  } catch (e) {
    return fail(e, "Preview failed.");
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSuperAdmin())) return unauthorized();
  const identity = await getActionActor();
  if (!identity) return unauthorized();
  const actor: WriteActor = { id: identity.id, name: identity.name };

  const { id } = await ctx.params;
  try {
    return NextResponse.json({ ok: true, result: await promoteLead({ leadId: id, actor }) });
  } catch (e) {
    return fail(e, "Promotion failed.");
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSuperAdmin())) return unauthorized();
  const identity = await getActionActor();
  if (!identity) return unauthorized();
  const actor: WriteActor = { id: identity.id, name: identity.name };

  const { id } = await ctx.params;
  try {
    return NextResponse.json({ ok: true, result: await demoteLead({ leadId: id, actor }) });
  } catch (e) {
    return fail(e, "Demotion failed.");
  }
}
