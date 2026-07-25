import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import {
  planBulkAssign,
  commitBulkAssign,
  revertAssignBatch,
  listAssignBatches,
  BulkAssignError,
  BULK_ASSIGN_MAX,
  TYPED_CONFIRMATION_THRESHOLD,
  type BulkAssignPlan,
  type BulkAssignFilter,
  type Distribution,
  type LeadScope,
} from "@/lib/legacy-crm/bulkAssign";
import type { WriteActor } from "@/lib/legacy-crm/writes";

export const dynamic = "force-dynamic";

/**
 * PHASE 3 — bulk ASSIGNMENT. Ownership only.
 *
 * There is no bulk status change, no bulk edit, no bulk delete and no send on
 * any path in this file. The only column reachable from here is `assigned_to`.
 *
 * THE PREVIEW IS NOT ADVISORY. `mode:"preview"` returns a manifest — the
 * explicit list of lead ids and the assignee chosen for each — and
 * `mode:"commit"` applies that manifest verbatim. It never re-runs the filter.
 * That is what makes the number the operator approved the number that happens,
 * even though the public site is inserting new leads the whole time.
 *
 * Above TYPED_CONFIRMATION_THRESHOLD rows the operator must type a phrase that
 * encodes the row count, and the server re-derives that phrase from what is
 * actually about to change rather than trusting the preview's figure.
 */

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

type Body = {
  mode?: "preview" | "commit" | "revert";
  filter?: BulkAssignFilter;
  lead_ids?: string[];
  distribution?: Distribution;
  scope?: LeadScope;
  plan?: BulkAssignPlan;
  typed_confirmation?: string | null;
  batch_id?: string;
};

/** Recent batches, so the UI can offer "undo that". */
export async function GET() {
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({
      ok: true,
      limits: { max: BULK_ASSIGN_MAX, typedConfirmationAbove: TYPED_CONFIRMATION_THRESHOLD },
      batches: await listAssignBatches(20),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to list batches." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const identity = await getActionActor();
  if (!identity) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const actor: WriteActor = { id: identity.id, name: identity.name };

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("Body must be valid JSON.");
  }

  try {
    switch (body.mode) {
      case "preview": {
        const distribution = validateDistribution(body.distribution);
        if (typeof distribution === "string") return bad(distribution);
        if (!body.filter && !body.lead_ids?.length) {
          return bad("Supply either `filter` or `lead_ids`.");
        }
        const plan = await planBulkAssign({
          filter: body.filter,
          leadIds: body.lead_ids,
          distribution,
          scope: body.scope,
        });
        return NextResponse.json({ ok: true, plan });
      }

      case "commit": {
        if (!body.plan) return bad("Missing `plan`. Preview first — commit applies a plan, not a filter.");
        if (!body.plan.assignments || typeof body.plan.assignments !== "object") {
          return bad("`plan.assignments` is missing or malformed.");
        }
        const result = await commitBulkAssign({
          plan: body.plan,
          actor,
          typedConfirmation: body.typed_confirmation,
        });
        return NextResponse.json({ ok: true, result });
      }

      case "revert": {
        if (!body.batch_id) return bad("Missing `batch_id`.");
        return NextResponse.json({
          ok: true,
          result: await revertAssignBatch(body.batch_id, actor),
        });
      }

      default:
        return bad('`mode` must be one of "preview", "commit", "revert".');
    }
  } catch (e) {
    if (e instanceof BulkAssignError) {
      // Operator-correctable: an unknown assignee, a batch over the cap, a
      // confirmation phrase that no longer matches. 422 rather than 500 —
      // the request was understood and deliberately refused.
      return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Bulk assignment failed." },
      { status: 500 },
    );
  }
}

/** Returns the parsed distribution, or an error string. */
function validateDistribution(d: Distribution | undefined): Distribution | string {
  if (!d || typeof d !== "object") return "Missing `distribution`.";

  if (d.mode === "single") {
    if (!d.assignee || typeof d.assignee !== "string") return "`single` needs an `assignee`.";
    return { mode: "single", assignee: d.assignee.trim() };
  }

  if (d.mode === "round_robin") {
    if (!Array.isArray(d.assignees) || d.assignees.length === 0) {
      return "`round_robin` needs a non-empty `assignees` array.";
    }
    const names = d.assignees.map((a) => String(a).trim()).filter(Boolean);
    if (!names.length) return "`assignees` contained no usable names.";
    if (new Set(names).size !== names.length) {
      // Silently de-duplicating would double one person's share without
      // saying so, and the preview would look correct.
      return "`assignees` contains duplicates — each counsellor may appear once.";
    }
    return { mode: "round_robin", assignees: names };
  }

  if (d.mode === "fixed") {
    if (!Array.isArray(d.allocations) || d.allocations.length === 0) {
      return "`fixed` needs a non-empty `allocations` array.";
    }
    const allocations: { username: string; count: number }[] = [];
    for (const a of d.allocations) {
      const username = String(a?.username ?? "").trim();
      const count = Number(a?.count);
      if (!username) return "Every allocation needs a `username`.";
      if (!Number.isInteger(count) || count < 0) {
        return `Allocation for ${username} must be a non-negative whole number.`;
      }
      allocations.push({ username, count });
    }
    const total = allocations.reduce((s, a) => s + a.count, 0);
    if (total === 0) return "Allocations total zero — nothing would be assigned.";
    if (total > BULK_ASSIGN_MAX) {
      return `Allocations total ${total}, over the ${BULK_ASSIGN_MAX}-row cap for one operation.`;
    }
    return { mode: "fixed", allocations };
  }

  return '`distribution.mode` must be "single", "round_robin" or "fixed".';
}
