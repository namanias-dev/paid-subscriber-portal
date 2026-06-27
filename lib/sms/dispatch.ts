/**
 * Event-driven auto-SMS dispatch. Called fire-and-forget from the existing
 * analytics emitters (the REAL event chokepoints). Deliberately imports NO
 * dataProvider/analytics module (login_code is read straight from Supabase) so
 * there is zero import cycle with lib/analytics/server.ts.
 *
 * Every auto-rule defaults OFF; this no-ops unless a Super Admin enabled it.
 */
import { getSupabaseAdmin } from "../supabase";
import { normalizeIndianMobile } from "../phone";
import { getRule } from "./store";
import { sendSms, type RelatedEntity } from "./service";

async function loginByPhone(digits10: string): Promise<{ name: string | null; login_code: string | null }> {
  const db = getSupabaseAdmin();
  if (!db) return { name: null, login_code: null };
  try {
    const { data } = await db.from("buyers").select("name,login_code").eq("phone", digits10).maybeSingle();
    return { name: (data?.name as string) ?? null, login_code: (data?.login_code as string) ?? null };
  } catch { return { name: null, login_code: null }; }
}

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
  if (vars.login_code === undefined || vars.login_code === null || vars.login_code === "") {
    const b = await loginByPhone(digits);
    vars.login_code = b.login_code || "";
    if ((vars.name === undefined || vars.name === "") && b.name) vars.name = b.name;
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
