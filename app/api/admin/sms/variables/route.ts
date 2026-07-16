import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, currentAdminId } from "@/lib/adminGuard";
import { listTemplates, getTemplate } from "@/lib/sms/store";
import { uniqueVariables } from "@/lib/sms/templates";
import { portalLoginUrl } from "@/lib/sms/config";
import {
  MANAGED_GLOBAL_VARIABLES, managedGlobal, GLOBAL_SCOPE,
  getAllScopes, setGlobalVariable, setTemplateVariable, isValidHttpUrl,
} from "@/lib/sms/variables";

export const dynamic = "force-dynamic";

/** Effective default value shown for a global variable when the store is empty. */
function globalFallback(key: string): string {
  if (key === "login_url") return portalLoginUrl();
  return "";
}

/**
 * GET — the Variables tab payload:
 *  • globals: each managed global variable, its current value (or config
 *    fallback), audit stamp, and which templates reference it.
 *  • templates: every template with its variables + any per-template overrides.
 */
export async function GET() {
  if (!(await requirePermission("send_sms"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const [templates, scopes] = await Promise.all([listTemplates(), getAllScopes()]);
  const globalScope = scopes[GLOBAL_SCOPE];

  const globals = MANAGED_GLOBAL_VARIABLES.map((v) => {
    const stored = globalScope?.data?.[v.key] ?? "";
    const usedBy = templates
      .filter((t) => (t.variables || []).includes(v.key))
      .map((t) => ({ id: t.id, name: t.name }));
    return {
      key: v.key,
      label: v.label,
      kind: v.kind,
      description: v.description,
      value: stored,
      effective: stored || globalFallback(v.key),
      isDefault: !stored,
      updated_by: globalScope?.updated_by ?? null,
      updated_at: globalScope?.updated_at ?? null,
      usedBy,
    };
  });

  const templatesOut = templates.map((t) => {
    const sc = scopes[t.id];
    return {
      id: t.id,
      name: t.name,
      use_case: t.use_case,
      variables: t.variables || [],
      overrides: sc?.data || {},
      updated_by: sc?.updated_by ?? null,
      updated_at: sc?.updated_at ?? null,
    };
  });

  return NextResponse.json({ ok: true, isSuperAdmin: await requireSuperAdmin(), globals, templates: templatesOut });
}

/**
 * PATCH — set (or clear) a variable value. Super Admin only. Body:
 *   { scope: "global" | "<templateId>", key: string, value: string }
 * Empty value clears the override (reverts to global/config). URL-kind values
 * are validated as well-formed http(s). Audited via updated_by.
 */
export async function PATCH(req: Request) {
  // Operational: editing message variables/content is a day-to-day Mission Control
  // action. Gated by manage_sms (Admin + Super Admin), NOT the send-safety flag.
  if (!(await requirePermission("manage_sms"))) return NextResponse.json({ ok: false, error: "Requires SMS management permission" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const scope = String(body.scope || "").trim();
  const key = String(body.key || "").trim();
  const rawValue = body.value === null || body.value === undefined ? "" : String(body.value);
  const value = rawValue.trim();
  if (!scope || !key) return NextResponse.json({ ok: false, error: "Missing scope or key" }, { status: 400 });

  const by = await currentAdminId();

  if (scope === GLOBAL_SCOPE) {
    const meta = managedGlobal(key);
    if (!meta) return NextResponse.json({ ok: false, error: `Unknown global variable "${key}"` }, { status: 400 });
    if (value && meta.kind === "url" && !isValidHttpUrl(value)) {
      return NextResponse.json({ ok: false, error: "Enter a well-formed http(s) URL." }, { status: 400 });
    }
    await setGlobalVariable(key, value || null, by);
    return NextResponse.json({ ok: true, scope, key, value: value || null, effective: value || globalFallback(key) });
  }

  // per-template override
  const tpl = await getTemplate(scope);
  if (!tpl) return NextResponse.json({ ok: false, error: "Template not found" }, { status: 404 });
  const allowed = new Set(uniqueVariables(tpl.body_template));
  if (!allowed.has(key)) {
    return NextResponse.json({ ok: false, error: `"${key}" is not a variable used by this template.` }, { status: 400 });
  }
  const looksUrl = key === "login_url" || key.endsWith("_url");
  if (value && looksUrl && !isValidHttpUrl(value)) {
    return NextResponse.json({ ok: false, error: "Enter a well-formed http(s) URL." }, { status: 400 });
  }
  await setTemplateVariable(scope, key, value || null, by);
  return NextResponse.json({ ok: true, scope, key, value: value || null });
}
