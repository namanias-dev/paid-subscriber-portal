import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import {
  NOTES_APPROVED_TEMPLATES,
  NOTES_SMS_SOURCE_FILE,
  notesApprovedByKey,
  notesCanonicalRow,
  notesNonAsciiCharacters,
  notesTemplateDrift,
} from "@/lib/sms/notesApproved";
import { getSettings, getTemplate, listNotesSmsLogs, updateSettings, upsertRule, upsertTemplate } from "@/lib/sms/store";
import { pollDeliveryStatuses } from "@/lib/sms/service";
import { storeFeatureEnabled } from "@/lib/store/flags";
import { storeDb } from "@/lib/store/db";
import { loadCheckoutLeadPlan, loadOrderPlan, loadTemplateContext, notes500Problem } from "@/lib/store/sms/load";
import { notesReasonText, notesTemplateHold, type NotesSmsPlan } from "@/lib/store/sms/plan";
import { sendNotesPlan } from "@/lib/store/sms/send";
import { NOTES_AUTOMATION_KEYS, notesAutomationRules } from "@/lib/store/sms/automation";
import { maskNotesPhone } from "@/lib/store/sms/values";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Plan as shown to staff: masked destination, reason texts, never the full phone. */
function publicPlan(plan: NotesSmsPlan) {
  return {
    templateKey: plan.templateKey,
    templateId: plan.templateId,
    dltTemplateId: plan.dltTemplateId,
    dltType: plan.dltType,
    approvedText: plan.approvedText,
    variables: plan.variables,
    text: plan.text,
    destination: plan.destination.masked,
    customerName: plan.customerName,
    source: plan.source,
    dedupeKey: plan.dedupeKey,
    ok: plan.ok,
    hold: plan.hold,
    holdText: plan.hold ? notesReasonText(plan.hold) : null,
    blockers: plan.blockers.map((code) => ({ code, text: notesReasonText(code) })),
  };
}

type Stats = { total: number; queued: number; sent: number; delivered: number; failed: number; lastAt: string | null };

export async function GET() {
  if (!(await requirePermission("send_sms"))) return json({ ok: false, error: "Unauthorized" }, 401);
  try { await pollDeliveryStatuses({ sinceDays: 2, limit: 150 }); } catch { /* non-fatal */ }

  const now = new Date();
  const since7 = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [flagOn, settings, rules, logs, codeProblem] = await Promise.all([
    storeFeatureEnabled("notes_store_sms"),
    getSettings(),
    notesAutomationRules(),
    listNotesSmsLogs({ templateIds: NOTES_APPROVED_TEMPLATES.map((t) => t.id), sinceIso: since7, limit: 2000 }).catch(() => null),
    notes500Problem(now).catch(() => "unverified"),
  ]);

  const stats = new Map<string, Stats>();
  const byTrigger = new Map<string, Stats>();
  const bump = (m: Map<string, Stats>, k: string, status: string, at: string) => {
    const s = m.get(k) || { total: 0, queued: 0, sent: 0, delivered: 0, failed: 0, lastAt: null };
    s.total++;
    if (status === "QUEUED") s.queued++;
    else if (status === "SENT") s.sent++;
    else if (status === "DELIVERED") s.delivered++;
    else if (status === "FAILED") s.failed++;
    if (!s.lastAt || at > s.lastAt) s.lastAt = at;
    m.set(k, s);
  };
  for (const l of logs || []) {
    bump(stats, l.template_id || "", l.status, l.created_at);
    bump(byTrigger, l.trigger_event || "", l.status, l.created_at);
  }

  const templates = await Promise.all(
    NOTES_APPROVED_TEMPLATES.map(async (t) => {
      const ctx = await loadTemplateContext(t, now).catch(() => ({ row: null }));
      const row = ctx.row;
      const hold = notesTemplateHold(t, ctx);
      return {
        key: t.key,
        id: t.id,
        dltTemplateId: t.dltTemplateId,
        dltType: t.dltType,
        messageType: t.messageType,
        trigger: t.trigger,
        approvedText: t.approvedText,
        trackerSample: t.trackerSample,
        sourceRow: t.sourceRow,
        variables: t.variables,
        nonAscii: notesNonAsciiCharacters(t),
        stored: row
          ? { body: row.body_template, dltId: row.gateway_template_id, messageType: row.message_type, category: row.category ?? null, status: row.status }
          : null,
        drift: notesTemplateDrift(t, row),
        hold,
        holdText: hold ? notesReasonText(hold) : null,
        automated: NOTES_AUTOMATION_KEYS.includes(t.key),
        stats7d: stats.get(t.id) || null,
      };
    }),
  );

  const recent = (logs || []).slice(0, 25).map((l) => ({
    id: l.id,
    templateId: l.template_id,
    status: l.status,
    to: maskNotesPhone(l.normalized_mobile),
    trigger: l.trigger_event,
    createdAt: l.created_at,
    sentAt: l.sent_at,
    error: l.error_message,
    sentByType: l.sent_by_type,
  }));

  return json({
    ok: true,
    source: NOTES_SMS_SOURCE_FILE,
    flagOn,
    globalEnabled: settings.enabled,
    window: { start: settings.windowStart, end: settings.windowEnd, promoStart: settings.promoWindowStart, promoEnd: settings.promoWindowEnd },
    notes500: { problem: codeProblem, text: codeProblem ? notesReasonText(`promo_code_${codeProblem}`) : null },
    templates,
    automations: Object.values(rules).map((r) => ({ ...r, stats7d: byTrigger.get(r.trigger) || null })),
    logsAvailable: logs !== null,
    recent,
  });
}

async function resolveOrderId(body: Record<string, unknown>): Promise<string | null> {
  const id = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (/^[0-9a-f-]{36}$/i.test(id)) return id;
  const no = typeof body.orderNo === "string" ? body.orderNo.trim().toUpperCase() : "";
  if (!/^NIAS-N-\d{4}-\d{3,8}$/.test(no)) return null;
  const db = storeDb();
  if (!db) return null;
  const { data } = await db.from("store_orders").select("id").eq("order_no", no).maybeSingle();
  return (data?.id as string | undefined) || null;
}

/**
 * Preview / send one Notes SMS for one order or checkout lead. The client names
 * only the template and the record; phone, amount, subject and URL are always
 * resolved on the server from that record.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "preview");
  if (!(await requirePermission("send_sms"))) return json({ ok: false, error: "Unauthorized" }, 401);

  if (action === "reconcile_template") {
    if (!(await requireSuperAdmin())) return json({ ok: false, error: "Super Admin only" }, 403);
    const t = notesApprovedByKey(String(body.templateKey || ""));
    if (!t) return json({ ok: false, error: "Unknown template" }, 400);
    const before = await getTemplate(t.id);
    const drift = notesTemplateDrift(t, before);
    if (!drift.length) return json({ ok: true, changed: false, drift });
    const { id: _id, ...canonical } = notesCanonicalRow(t);
    const saved = await upsertTemplate(t.id, { ...canonical, updated_by: await currentAdminId() }, !before);
    if (!saved) return json({ ok: false, error: "Save failed" }, 500);
    console.info(`[notes-sms] template_reconciled ${t.key} fields=${drift.join(",")}`);
    return json({ ok: true, changed: true, drift, after: notesTemplateDrift(t, saved) });
  }

  const t = notesApprovedByKey(String(body.templateKey || ""));
  if (!t) return json({ ok: false, error: "Unknown template" }, 400);
  if (action !== "preview" && action !== "send") return json({ ok: false, error: "Unknown action" }, 400);
  if (action === "send") {
    const allowed = t.messageType === "promotional"
      ? await requireSuperAdmin()
      : await requirePermission("store_manage_orders");
    if (!allowed) {
      return json({ ok: false, error: t.messageType === "promotional" ? "Promotional sends need a Super Admin" : "Requires Notes order management permission" }, 403);
    }
  } else if (!(await requirePermission("store_view_orders"))) {
    return json({ ok: false, error: "Requires Notes order view permission" }, 403);
  }

  const now = new Date();
  let plan: NotesSmsPlan;
  let reload: () => Promise<NotesSmsPlan>;
  try {
    if (t.key === "NOTES_ORDER_CONFIRMED_01" || t.key === "NOTES_PAYMENT_PENDING_01") {
      const orderId = await resolveOrderId(body);
      if (!orderId) return json({ ok: false, error: "Order not found" }, 404);
      plan = (await loadOrderPlan(t.key, orderId, now)).plan;
      reload = async () => (await loadOrderPlan(t.key, orderId, now)).plan;
    } else {
      const leadId = typeof body.checkoutLeadId === "string" ? body.checkoutLeadId.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(leadId)) return json({ ok: false, error: "Checkout lead not found" }, 404);
      plan = (await loadCheckoutLeadPlan(t.key, leadId, now)).plan;
      reload = async () => (await loadCheckoutLeadPlan(t.key, leadId, now)).plan;
    }
  } catch {
    return json({ ok: false, error: "Could not read the record. Nothing was sent." }, 503);
  }

  if (action === "preview") return json({ ok: true, plan: publicPlan(plan) });

  const outcome = await sendNotesPlan(plan, {
    mode: "manual",
    sentBy: { type: "ADMIN", userId: await currentAdminId() },
    reload,
    now,
  });
  return json({
    ok: outcome.status === "submitted",
    status: outcome.status,
    reason: outcome.reason,
    reasonText: outcome.reason ? notesReasonText(outcome.reason) : null,
    logId: outcome.logId,
    plan: publicPlan(outcome.plan),
  });
}

/** Switch a Notes automation on/off (Super Admin). Switching on records the cutover. */
export async function PATCH(req: Request) {
  if (!(await requireSuperAdmin())) return json({ ok: false, error: "Super Admin only" }, 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const t = NOTES_APPROVED_TEMPLATES.find((x) => x.trigger === body.trigger && NOTES_AUTOMATION_KEYS.includes(x.key));
  if (!t) return json({ ok: false, error: "Unknown Notes automation" }, 400);
  const enabled = !!body.enabled;
  const now = new Date();
  if (enabled) {
    const hold = notesTemplateHold(t, await loadTemplateContext(t, now));
    if (hold) return json({ ok: false, error: notesReasonText(hold), hold }, 409);
  }
  const patch: Record<string, unknown> = { enabled, template_id: t.id, updated_by: await currentAdminId() };
  if (t.key === "NOTES_PAYMENT_PENDING_01" && body.delay_minutes !== undefined) {
    const d = Number(body.delay_minutes);
    if (!Number.isFinite(d) || d < 60 || d > 720) return json({ ok: false, error: "Delay must be 60–720 minutes" }, 400);
    patch.delay_minutes = Math.round(d);
  }
  const before = (await notesAutomationRules())[t.trigger];
  const rule = await upsertRule(t.trigger, patch);
  if (!rule || rule.enabled !== enabled) return json({ ok: false, error: "Save failed" }, 500);
  if (enabled && !before?.enabled) {
    const settings = await getSettings();
    await updateSettings({ notesCutover: { ...(settings.notesCutover || {}), [t.trigger]: now.toISOString() } }, await currentAdminId());
  }
  return json({ ok: true, automation: (await notesAutomationRules())[t.trigger] });
}
