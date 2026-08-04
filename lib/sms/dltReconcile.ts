/**
 * Periodic DLT flag reconciliation — seed gateway id ↔ DB status.
 * Prevents silent draft flags disabling Remind.
 */
import { getSupabaseAdmin } from "../supabase";
import { SEED_TEMPLATES, uniqueVariables } from "./templates";

export interface DltReconcileRow {
  id: string;
  gatewayId: string;
  before: string;
  after: string | null;
  healed: boolean;
}

export async function reconcileDltTemplateFlags(): Promise<{ checked: number; healed: DltReconcileRow[]; mismatches: DltReconcileRow[] }> {
  const db = getSupabaseAdmin();
  const healed: DltReconcileRow[] = [];
  const mismatches: DltReconcileRow[] = [];
  if (!db) return { checked: 0, healed, mismatches };

  const seeds = SEED_TEMPLATES.filter((s) => !!s.gateway_template_id);
  const { data } = await db.from("sms_templates").select("id,status,is_active,gateway_template_id,body_template");
  const byId = new Map((data || []).map((r) => [String(r.id), r]));

  for (const s of seeds) {
    const row = byId.get(s.id);
    if (!row) {
      mismatches.push({ id: s.id, gatewayId: s.gateway_template_id!, before: "missing", after: null, healed: false });
      continue;
    }
    const status = String(row.status || "");
    const gidOk = String(row.gateway_template_id || "") === s.gateway_template_id;
    const sendReady = status === "active" || status === "approved";
    if (!gidOk) {
      mismatches.push({
        id: s.id,
        gatewayId: s.gateway_template_id!,
        before: `gid=${row.gateway_template_id}`,
        after: null,
        healed: false,
      });
      continue;
    }
    if (!sendReady || !row.is_active) {
      await db.from("sms_templates").update({
        status: "approved",
        is_active: true,
        gateway_template_id: s.gateway_template_id,
        body_template: s.body,
        variables: uniqueVariables(s.body),
        updated_at: new Date().toISOString(),
      }).eq("id", s.id);
      healed.push({
        id: s.id,
        gatewayId: s.gateway_template_id!,
        before: `${status}/${row.is_active}`,
        after: "approved/true",
        healed: true,
      });
    }
  }
  return { checked: seeds.length, healed, mismatches };
}
