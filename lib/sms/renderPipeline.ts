/**
 * SINGLE SOURCE OF TRUTH for SMS render.
 *
 * Every preview and every send (single, bulk, auto, access-reminder) MUST go
 * through {@link prepareAndRenderSms}. That is the only place free-text DLT
 * vars are resolved (sms_short_title → auto-shorten → clamp) and the body is
 * validated (GSM-7 + hard send guard). Callers must not invent item_short
 * outside this pipeline for final rendering.
 */
import { checkRenderedBody, prepareDltFreeTextVars } from "./sendGuard";
import { DLT_FREE_TEXT_VAR_MAX, renderTemplate, validateBody } from "./templates";

export interface DltVarViolation {
  key: string;
  value: string;
  length: number;
  max: number;
}

export interface PreparedRender {
  ok: boolean;
  /** Final body that would go to the gateway. */
  text: string;
  /** Vars AFTER prepareDltFreeTextVars (shortened / clamped). */
  vars: Record<string, string | number | null | undefined>;
  missing: string[];
  errors: string[];
  warnings: string[];
  length: number;
  segments: number;
  gsm: boolean;
  blocked: string | null;
  dltViolations: DltVarViolation[];
}

/**
 * Prepare free-text DLT vars, render the template body, validate charset /
 * placeholders, and assert free-text slots are within the registered max.
 * Preview and send call this with the SAME inputs → identical strings.
 */
export function prepareAndRenderSms(
  bodyTemplate: string,
  templateId: string,
  mergedVars: Record<string, string | number | null | undefined>,
): PreparedRender {
  const prepared = prepareDltFreeTextVars(mergedVars, templateId);
  const { text, missing } = renderTemplate(bodyTemplate, prepared.vars);
  const v = validateBody(text);
  const guard = checkRenderedBody(text, prepared.vars);

  const dltViolations: DltVarViolation[] = [];
  for (const key of ["item_short", "item_name"] as const) {
    const val = prepared.vars[key];
    if (val == null) continue;
    const s = String(val);
    if (![...s].length) continue;
    const len = [...s].length;
    if (len > DLT_FREE_TEXT_VAR_MAX) {
      dltViolations.push({ key, value: s, length: len, max: DLT_FREE_TEXT_VAR_MAX });
    }
  }

  const errors = [
    ...(guard.ok ? v.errors : [...v.errors, guard.detail!]),
    ...dltViolations.map(
      (d) =>
        `[SMS DLT] BLOCK template=${templateId} var=${d.key} len=${d.length}>${d.max}: "${d.value}"`,
    ),
  ];
  if (dltViolations.length) {
    for (const d of dltViolations) {
      console.error(
        `[SMS DLT] BLOCK template=${templateId} var=${d.key} len=${d.length}>${d.max}: "${d.value}"`,
      );
    }
  }

  return {
    ok: v.ok && missing.length === 0 && guard.ok && dltViolations.length === 0,
    text,
    vars: prepared.vars,
    missing,
    errors,
    warnings: [...v.warnings, ...prepared.warnings],
    length: v.analysis.length,
    segments: v.analysis.segments,
    gsm: v.analysis.gsm,
    blocked: guard.ok ? (dltViolations.length ? "dlt_var_too_long" : null) : guard.reason,
    dltViolations,
  };
}
