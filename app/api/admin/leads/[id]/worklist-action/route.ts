import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import {
  addLeadNote,
  assignLead,
  FrozenFieldWriteError,
  LeadNotFoundError,
  markOptedOut,
  markUnreachable,
  markWrongNumber,
  recordContactAttempt,
  revertWrite,
  setFollowUp,
  setWorkStatus,
  type WriteActor,
} from "@/lib/legacy-crm/writes";
import { LEAD_WORK_STATUSES, type LeadWorkStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * PHASE 2 — per-lead WRITE actions.
 *
 * One endpoint, one `action` discriminator, so there is exactly one place where
 * permission, validation, and auditing happen for every CRM write.
 *
 * Every action is audited, idempotent, reversible and batch-tagged by
 * `lib/legacy-crm/writes.ts`. This route's job is to authenticate, validate the
 * input, and translate errors into honest status codes.
 *
 * WHAT THIS ENDPOINT CANNOT DO
 * ----------------------------
 * It cannot write `status` or `legacy_call_status_raw`. Not "does not" —
 * cannot: the write layer allow-lists columns and re-checks the built patch
 * against a frozen list immediately before sending. A request that tries
 * returns 422, not a silent partial write.
 *
 * It also sends NOTHING. There is no SMS, WhatsApp, email or call trigger on
 * any path here. Marking a lead opted-out sets `consent_status='opted_out'` so
 * the suppression is already correct for whenever sending is eventually
 * enabled.
 */

type Body = {
  action?: string;
  work_status?: string;
  assignee?: string | null;
  follow_up_at?: string | null;
  body?: string;
  audit_id?: string;
};

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const identity = await getActionActor();
  if (!identity) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const actor: WriteActor = { id: identity.id, name: identity.name };

  const leadId = ctx.params.id;
  if (!leadId) return bad("Missing lead id.");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("Body must be valid JSON.");
  }

  const action = body.action;
  if (!action) return bad("Missing `action`.");

  try {
    switch (action) {
      case "work_status": {
        const value = body.work_status as LeadWorkStatus | undefined;
        if (!value || !LEAD_WORK_STATUSES.includes(value)) {
          return bad(`Unknown work_status "${value}". Allowed: ${LEAD_WORK_STATUSES.join(", ")}.`);
        }
        return NextResponse.json({ ...(await setWorkStatus(leadId, value, actor)) });
      }

      case "assign": {
        // `null` is meaningful (unassign), so only `undefined` is an error.
        const assignee = body.assignee === undefined ? undefined : body.assignee;
        if (assignee === undefined) return bad("Missing `assignee` (use null to unassign).");
        const clean = assignee === null ? null : String(assignee).trim();
        if (clean !== null && clean.length === 0) return bad("`assignee` cannot be blank — use null to unassign.");
        return NextResponse.json({ ...(await assignLead(leadId, clean, actor)) });
      }

      case "follow_up": {
        const when = body.follow_up_at === undefined ? undefined : body.follow_up_at;
        if (when === undefined) return bad("Missing `follow_up_at` (use null to clear).");
        if (when !== null && Number.isNaN(Date.parse(when))) return bad("`follow_up_at` is not a valid date.");
        const iso = when === null ? null : new Date(when).toISOString();
        return NextResponse.json({ ...(await setFollowUp(leadId, iso, actor)) });
      }

      case "wrong_number":
        return NextResponse.json({ ...(await markWrongNumber(leadId, actor)) });

      case "unreachable":
        return NextResponse.json({ ...(await markUnreachable(leadId, actor)) });

      case "opt_out":
        return NextResponse.json({ ...(await markOptedOut(leadId, actor)) });

      case "contact_attempt":
        return NextResponse.json({ ...(await recordContactAttempt(leadId, actor)) });

      case "note": {
        if (!body.body || !body.body.trim()) return bad("A note cannot be empty.");
        return NextResponse.json({ ...(await addLeadNote({ leadId, body: body.body, actor })) });
      }

      case "revert": {
        if (!body.audit_id) return bad("Missing `audit_id`.");
        return NextResponse.json({ ...(await revertWrite(body.audit_id, actor)) });
      }

      default:
        return bad(`Unknown action "${action}".`);
    }
  } catch (e) {
    if (e instanceof LeadNotFoundError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    if (e instanceof FrozenFieldWriteError) {
      // 422: the request was well-formed but asks for something that must
      // never happen. The message names the field and says why.
      return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    }
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error(`[leads/worklist-action] ${action} failed:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
