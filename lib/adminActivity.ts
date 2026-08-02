/**
 * Append-only admin activity log. Logging failures NEVER fail the business op.
 */
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "./supabase";
import type { ActionActor } from "./adminGuard";

export type AdminActivityAction =
  | "payment_proof_uploaded"
  | "payment_proof_approved"
  | "payment_proof_rejected"
  | "manual_student_registration"
  | "payment_recorded_manually"
  | "installment_recorded_manually"
  | "leads_csv_exported"
  | "phone_audience_copied"
  | "export_permission_toggled"
  | "telegram_broadcast_sent"
  | "telegram_direct_send"
  | "telegram_automation_updated";

export const ADMIN_ACTIVITY_LABELS: Record<AdminActivityAction, string> = {
  payment_proof_uploaded: "Payment proof uploaded",
  payment_proof_approved: "Payment proof approved",
  payment_proof_rejected: "Payment proof rejected",
  manual_student_registration: "Manual student registration",
  payment_recorded_manually: "Payment recorded manually",
  installment_recorded_manually: "Installment recorded manually",
  leads_csv_exported: "Leads CSV exported",
  phone_audience_copied: "Phone audience copied",
  export_permission_toggled: "CSV export permission toggled",
  telegram_broadcast_sent: "Telegram broadcast sent",
  telegram_direct_send: "Telegram direct send",
  telegram_automation_updated: "Telegram automation updated",
};

export interface AdminActivityRow {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface LogAdminActivityInput {
  actor?: ActionActor | null;
  action: AdminActivityAction;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget insert. Never throws to callers. */
export async function logAdminActivity(input: LogAdminActivityInput): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    if (!db) return;
    const row = {
      id: randomUUID(),
      actor_user_id: input.actor?.id ?? null,
      actor_name: input.actor?.name ?? null,
      actor_role: input.actor?.role ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
      created_at: new Date().toISOString(),
    };
    await db.from("admin_activity").insert(row);
  } catch {
    /* never fail the business operation */
  }
}

export interface ListAdminActivityOpts {
  actorId?: string | null;
  action?: string | null;
  entityType?: string | null;
  fromISO?: string | null;
  toISO?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
}

export async function listAdminActivity(
  opts: ListAdminActivityOpts = {},
): Promise<{ rows: AdminActivityRow[]; total: number }> {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], total: 0 };
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let q = db
    .from("admin_activity")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (opts.actorId) q = q.eq("actor_user_id", opts.actorId);
  if (opts.action) q = q.eq("action", opts.action);
  if (opts.entityType) q = q.eq("entity_type", opts.entityType);
  if (opts.fromISO) q = q.gte("created_at", opts.fromISO);
  if (opts.toISO) q = q.lt("created_at", opts.toISO);
  if (opts.q?.trim()) {
    const term = opts.q.trim().replace(/[%_]/g, "");
    // Search name/phone inside metadata JSON text.
    q = q.or(`actor_name.ilike.%${term}%,metadata::text.ilike.%${term}%`);
  }

  const { data, count, error } = await q.range(from, to);
  if (error) return { rows: [], total: 0 };
  return { rows: (data as AdminActivityRow[]) || [], total: count ?? 0 };
}
