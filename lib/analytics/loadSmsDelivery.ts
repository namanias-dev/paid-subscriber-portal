/**
 * Read SMS send logs for a report window. Does not send SMS and does not
 * select message bodies or OTPs.
 */
import { getSupabaseAdmin } from "../supabase";
import { tgLog } from "../telegram/log";
import type { TimeWindow } from "./businessMetrics";
import { computeSmsDelivery, type SmsCohortRow, type SmsDeliveryMetrics } from "./smsDelivery";

interface LogRow {
  id: string;
  status: string;
  template_id: string | null;
  template_name: string | null;
  normalized_mobile: string | null;
  dedupe_key: string | null;
  created_at: string;
  course_enrollment_id?: string | null;
  installment_no?: number | null;
}

export async function loadSmsDelivery(
  window: TimeWindow,
  excludedMobiles?: Set<string>,
): Promise<SmsDeliveryMetrics | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const fromIso = new Date(window.fromMs).toISOString();
  const toIso = new Date(window.toMs).toISOString();
  const rows: SmsCohortRow[] = [];

  const selectWide =
    "id,status,template_id,template_name,normalized_mobile,dedupe_key,created_at,course_enrollment_id,installment_no";
  const selectNarrow = "id,status,template_id,template_name,normalized_mobile,dedupe_key,created_at";

  let wide = true;
  for (let from = 0; from < 20_000; from += 1000) {
    const q = db
      .from("sms_logs")
      .select(wide ? selectWide : selectNarrow)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    const { data, error } = await q;
    if (error) {
      const message = error.message || "query_failed";
      if (wide && /course_enrollment_id|installment_no/i.test(message)) {
        wide = false;
        from = -1000;
        rows.length = 0;
        continue;
      }
      tgLog("sms_delivery_query_failed", { error: message }, "warn");
      return null;
    }
    const page = (data || []) as unknown as LogRow[];
    for (const row of page) {
      rows.push({
        id: row.id,
        status: row.status,
        templateId: row.template_id,
        templateName: row.template_name,
        mobile: row.normalized_mobile,
        dedupeKey: row.dedupe_key,
        createdAt: row.created_at,
        enrollmentId: row.course_enrollment_id,
        installmentNo: row.installment_no,
      });
    }
    if (page.length < 1000) break;
  }

  const missingName = [...new Set(rows.filter((r) => !r.templateName && r.templateId).map((r) => r.templateId!))];
  if (missingName.length) {
    const { data } = await db.from("sms_templates").select("id,name").in("id", missingName.slice(0, 200));
    const names = new Map<string, string>();
    for (const row of (data || []) as { id: string; name: string | null }[]) {
      if (row.name) names.set(row.id, row.name);
    }
    for (const row of rows) {
      if (!row.templateName && row.templateId && names.has(row.templateId)) {
        row.templateName = names.get(row.templateId)!;
      }
    }
  }

  return computeSmsDelivery(rows, window, { excludedMobiles });
}
