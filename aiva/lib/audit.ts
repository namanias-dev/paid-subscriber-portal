import { getSupabase } from "./supabase";

/**
 * AIVA immutable audit log. Every action attempt (including blocked ones) is recorded.
 * Best-effort write; never throws into a caller.
 */
export type AuditEntry = {
  actor_id?: string | null;
  actor_username?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  risk?: string | null;
  outcome: "allowed" | "blocked" | "read";
  reason?: string | null;
  meta?: Record<string, unknown>;
};

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("aiva_audit_log").insert({
      actor_id: entry.actor_id ?? null,
      actor_username: entry.actor_username ?? null,
      action: entry.action,
      target_type: entry.target_type ?? null,
      target_id: entry.target_id ?? null,
      risk: entry.risk ?? null,
      outcome: entry.outcome,
      reason: entry.reason ?? null,
      meta: entry.meta ?? {},
      created_at: new Date().toISOString(),
    });
  } catch {
    /* audit is best-effort; do not break the request */
  }
}

export async function readAudit(limit = 100): Promise<AuditEntry[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data } = await sb
      .from("aiva_audit_log")
      .select("actor_username, action, target_type, target_id, risk, outcome, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as unknown as AuditEntry[]) || [];
  } catch {
    return [];
  }
}
