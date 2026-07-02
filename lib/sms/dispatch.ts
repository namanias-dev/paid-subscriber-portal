/**
 * Event-driven auto-SMS dispatch. Called fire-and-forget from the existing
 * analytics emitters (the REAL event chokepoints). Deliberately imports NO
 * dataProvider/analytics module (login_code is read straight from Supabase) so
 * there is zero import cycle with lib/analytics/server.ts.
 *
 * Every auto-rule defaults OFF; this no-ops unless a Super Admin enabled it.
 */
import { normalizeIndianMobile } from "../phone";
import { getRule, getBuyerById, resolveBuyerByPhone, firstNamesMatch } from "./store";
import { sendSms, type RelatedEntity } from "./service";

export interface AutoCtx {
  trigger: string;
  phone: string | null | undefined;
  name?: string | null;
  vars?: Record<string, string | number | null | undefined>;
  entity?: RelatedEntity;
  /** Stable id for the dedupe key (payment/registration/webinar/buyer). */
  entityId?: string | null;
}

/** Resolve the rule, fill login_code, and send once (idempotent via dedupe_key). */
async function dispatch(ctx: AutoCtx): Promise<void> {
  const rule = await getRule(ctx.trigger);
  if (!rule || !rule.enabled || !rule.template_id) return;
  const n = normalizeIndianMobile(ctx.phone);
  if (!n.ok || !n.digits10) return;
  const digits = n.digits10;

  const vars = { ...(ctx.vars || {}) };
  if (vars.name === undefined && ctx.name) vars.name = ctx.name;

  // Identity-safe login_code (Issue 2): resolve by BUYER ID when we have it (exact
  // person — safe even on shared numbers), else by phone but ONLY when exactly one
  // buyer holds that number. If the number is ambiguous, or the resolved buyer's
  // name disagrees with the intended recipient, we leave login_code empty so any
  // code-bearing template fails-closed via the existing missing_vars gate rather
  // than delivering the WRONG person's code.
  if (vars.login_code === undefined || vars.login_code === null || vars.login_code === "") {
    let resolved: { name: string | null; login_code: string | null } | null = null;
    if (ctx.entity?.user_id) resolved = await getBuyerById(ctx.entity.user_id);
    if (!resolved) {
      const r = await resolveBuyerByPhone(digits);
      if (r.status === "ok") resolved = { name: r.name, login_code: r.login_code };
    }
    const intended = (vars.name as string) || ctx.name || null;
    if (resolved && intended && !firstNamesMatch(intended, resolved.name)) resolved = null;
    if (resolved) {
      vars.login_code = resolved.login_code || "";
      if ((vars.name === undefined || vars.name === "") && resolved.name) vars.name = resolved.name;
    }
  }

  const entityId = ctx.entityId || ctx.entity?.payment_id || ctx.entity?.registration_id || ctx.entity?.webinar_id || ctx.entity?.user_id || digits;
  await sendSms({
    mobile: digits,
    templateId: rule.template_id,
    variables: vars,
    relatedEntity: { student_name: (vars.name as string) || ctx.name || null, ...(ctx.entity || {}) },
    sentBy: { type: "SYSTEM" },
    triggerEvent: ctx.trigger,
    audienceType: rule.audience_type,
    dedupeKey: `${ctx.trigger}:${rule.template_id}:${digits}:${entityId}`,
  });
}

/** Public fire-and-forget entry — never throws into the caller. */
export function fireAutoSms(ctx: AutoCtx): void {
  void dispatch(ctx).catch(() => {});
}
