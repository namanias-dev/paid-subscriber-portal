/**
 * AI Counselor Agent — SECURITY AUDIT writer.
 *
 * Appends a row to ai_security_audit for sensitive admin/agent actions:
 * reading a lead's PII, opt-out actions, and settings changes. Best-effort and
 * non-throwing — an audit failure must never break the underlying action.
 *
 * The `meta` payload is redacted before storage so an audit row never becomes a
 * PII leak of its own.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { redactObject } from "./security/redaction";

export interface AuditInput {
  /** Admin username/id from the guard, or 'system'. */
  actor: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown>;
}

export async function writeSecurityAudit(input: AuditInput): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    if (!db) return;
    await db.from("ai_security_audit").insert({
      actor: (input.actor || "system").slice(0, 200),
      action: (input.action || "").slice(0, 200),
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      ip: input.ip ?? null,
      meta: redactObject(input.meta || {}),
      created_at: new Date().toISOString(),
    });
  } catch {
    /* never throw from audit */
  }
}

/** Extract the caller IP from a request (first x-forwarded-for hop). */
export function ipFromRequest(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
