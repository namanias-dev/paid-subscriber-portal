/**
 * NOTES_NEW_LEAD_PROMO_01 for new academy leads.
 *
 * Lives on the SMS side because it reads academy `leads` (the store domain may
 * not). Eligibility is decided by the shared Notes builder: explicit consent,
 * not opted out, not already a Notes customer, frequency cap, promo hours.
 * Academy leads are created with consent_status "unknown", so today every lead
 * is refused for consent — the automation reports that instead of sending.
 */
import { getSupabaseAdmin } from "../supabase";
import { notesApprovedByKey } from "./notesApproved";
import { optedOutSet } from "./store";
import { normalizeIndianMobile } from "../phone";
import { buildAndValidateNotesAcademyLeadPromo, notesTemplateHold, type NotesSmsPlan } from "../store/sms/plan";
import { loadNotesHistory, loadOrdersForPhone, loadTemplateContext } from "../store/sms/load";
import { sendNotesPlan, type NotesSendOutcome } from "../store/sms/send";
import { NOTES_MAX_SENDS_PER_RUN, notesAutomationRules, type NotesJobReport } from "../store/sms/automation";

const LOOKBACK_HOURS = 24;
const KEY = "NOTES_NEW_LEAD_PROMO_01" as const;

interface LeadRow {
  id: string;
  phone: string | null;
  consent_status: string | null;
  source: string | null;
  created_at: string;
}

async function planForLead(lead: LeadRow, now: Date): Promise<NotesSmsPlan> {
  const t = notesApprovedByKey(KEY)!;
  const digits = normalizeIndianMobile(lead.phone).digits10 || null;
  const [ctx, phoneOrders, history] = await Promise.all([
    loadTemplateContext(t, now),
    loadOrdersForPhone(digits),
    loadNotesHistory(digits, now),
  ]);
  return buildAndValidateNotesAcademyLeadPromo({
    templateKey: KEY,
    ctx,
    lead: { id: lead.id, phone: lead.phone, consent_status: lead.consent_status, is_test: /test/i.test(lead.source || "") },
    phoneOrders,
    history,
    now,
  });
}

async function loadLead(id: string): Promise<LeadRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data, error } = await db.from("leads").select("id,phone,consent_status,source,created_at").eq("id", id).maybeSingle();
  if (error) throw new Error(`notes_promo_lead_read_failed: ${error.message}`);
  return (data as LeadRow | null) || null;
}

async function recentLeads(sinceIso: string): Promise<LeadRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data, error } = await db
    .from("leads")
    .select("id,phone,consent_status,source,created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(`notes_promo_leads_read_failed: ${error.message}`);
  return (data || []) as LeadRow[];
}

export interface NotesPromoAudienceSummary {
  scanned: number;
  eligible: number;
  blocked: Record<string, number>;
  optedOut: number;
  hold: string | null;
}

/** Dry run over academy leads created in the last 24 hours. Read-only. */
export async function notesLeadPromoDryRun(now = new Date()): Promise<NotesPromoAudienceSummary> {
  const t = notesApprovedByKey(KEY)!;
  const hold = notesTemplateHold(t, await loadTemplateContext(t, now));
  const leads = await recentLeads(new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000).toISOString());
  const digits = leads.map((l) => normalizeIndianMobile(l.phone).digits10).filter((d): d is string => !!d);
  const opted = await optedOutSet(digits);
  const out: NotesPromoAudienceSummary = { scanned: leads.length, eligible: 0, blocked: {}, optedOut: 0, hold };
  for (const lead of leads.slice(0, 100)) {
    const d = normalizeIndianMobile(lead.phone).digits10;
    if (d && opted.has(d)) {
      out.optedOut++;
      continue;
    }
    const plan = await planForLead(lead, now);
    if (plan.blockers.length === 0) out.eligible++;
    for (const b of plan.blockers) out.blocked[b] = (out.blocked[b] || 0) + 1;
  }
  return out;
}

/** Cron entry. Never throws. */
export async function runNotesNewLeadPromo(now = new Date()): Promise<NotesJobReport> {
  const r: NotesJobReport = { trigger: "notes_new_lead_promo", ran: false, reason: null, considered: 0, submitted: 0, failed: 0, skipped: {} };
  try {
    const state = (await notesAutomationRules()).notes_new_lead_promo;
    if (!state?.armed || !state.cutover) return { ...r, reason: state?.enabled ? "no_cutover" : "disabled" };
    const t = notesApprovedByKey(KEY)!;
    const hold = notesTemplateHold(t, await loadTemplateContext(t, now));
    if (hold) return { ...r, reason: hold };
    const since = new Date(Math.max(new Date(state.cutover).getTime(), now.getTime() - LOOKBACK_HOURS * 3_600_000)).toISOString();
    const leads = await recentLeads(since);
    r.ran = true;
    for (const lead of leads) {
      if (r.submitted + r.failed >= NOTES_MAX_SENDS_PER_RUN) break;
      r.considered++;
      const plan = await planForLead(lead, now);
      if (!plan.ok) {
        const reason = plan.blockers[0] || plan.hold || "not_eligible";
        r.skipped[reason] = (r.skipped[reason] || 0) + 1;
        continue;
      }
      const o: NotesSendOutcome = await sendNotesPlan(plan, {
        mode: "auto",
        sentBy: { type: "SYSTEM" },
        reload: async () => {
          const fresh = await loadLead(lead.id);
          if (!fresh) throw new Error("lead_gone");
          return planForLead(fresh, now);
        },
        now,
      });
      if (o.status === "submitted") r.submitted++;
      else if (o.status === "failed") r.failed++;
      else r.skipped[o.reason || "skipped"] = (r.skipped[o.reason || "skipped"] || 0) + 1;
    }
  } catch (e) {
    r.reason = `error:${(e as Error).message.slice(0, 80)}`;
  }
  return r;
}
