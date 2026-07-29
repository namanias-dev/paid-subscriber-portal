/**
 * Rebuild the message body for resend / retry.
 *
 * Historical trap: resendCampaignFailed and retryLog used to replay the STORED
 * message_body verbatim. That silently re-sent DLT-failing 51-char titles after
 * the short-title pipeline shipped. Resend MUST go through prepareAndRenderSms
 * whenever a template can be loaded; stored bodies are only allowed when they
 * do not embed a known over-length free-text title.
 */
import { getAllCourses, getWebinarById, getWebinarBySlug } from "../dataProvider";
import { formatISTTime } from "../dates";
import { checkRenderedBody } from "./sendGuard";
import { prepareAndRenderSms } from "./renderPipeline";
import { resolveSmsItemShort } from "./smsTitle";
import { getTemplate } from "./store";
import { DLT_FREE_TEXT_VAR_MAX } from "./templates";
import type { SmsLog } from "./types";
import { getResolvedDefaults } from "./variables";

export type ResendBodyResult =
  | { ok: true; text: string; length: number; segments: number; rerendered: boolean }
  | { ok: false; skip: string; detail?: string };

function extractPersonalTokens(body: string): { login_url?: string; login_code?: string } {
  const out: { login_url?: string; login_code?: string } = {};
  const url = body.match(/\bLogin:\s*(https?:\/\/[^\s]+)/i);
  if (url) out.login_url = url[1].replace(/[.,;:]+$/, "");
  const code = body.match(/\bCode:\s*([A-Za-z0-9]+)/i);
  if (code) out.login_code = code[1];
  return out;
}

async function resolveLinkedWebinar(idOrSlug: string) {
  const bySlug = await getWebinarBySlug(idOrSlug);
  if (bySlug) return bySlug;
  return getWebinarById(idOrSlug);
}

async function resolveLinkedCourse(idOrSlug: string) {
  const courses = await getAllCourses();
  return courses.find((c) => c.id === idOrSlug || c.slug === idOrSlug) || null;
}

/** True when the stored body still contains a public title longer than the DLT free-text max. */
export async function storedBodyLooksDltUnsafe(body: string): Promise<boolean> {
  const [webinars, courses] = await Promise.all([
    (await import("../dataProvider")).getWebinars(),
    getAllCourses(),
  ]);
  for (const w of webinars) {
    const title = (w.title || "").trim();
    if ([...title].length > DLT_FREE_TEXT_VAR_MAX && body.includes(title)) return true;
  }
  for (const c of courses) {
    const title = (c.title || "").trim();
    if ([...title].length > DLT_FREE_TEXT_VAR_MAX && body.includes(title)) return true;
  }
  return false;
}

export async function rebuildVarsFromLog(
  log: SmsLog,
): Promise<Record<string, string | number | null | undefined>> {
  const name = (log.student_name || "").trim();
  const vars: Record<string, string | number | null | undefined> = {
    name,
    first_name: name.split(/\s+/)[0] || "",
    mobile: log.normalized_mobile,
  };

  const extracted = extractPersonalTokens(log.message_body);
  if (extracted.login_code) vars.login_code = extracted.login_code;
  if (extracted.login_url) vars.login_url = extracted.login_url;

  if (log.webinar_id) {
    const w = await resolveLinkedWebinar(log.webinar_id);
    if (w) {
      const short = resolveSmsItemShort({ smsShortTitle: w.sms_short_title, fullTitle: w.title });
      vars.item_short = short;
      vars.item_name = short;
      vars.webinar_time = formatISTTime(w.datetime);
      vars.webinar_date = w.datetime;
    }
  } else if (log.course_id) {
    const c = await resolveLinkedCourse(log.course_id);
    if (c) {
      const short = resolveSmsItemShort({
        smsShortTitle: c.sms_short_title,
        fullTitle: c.title,
      });
      vars.item_short = short;
      vars.item_name = short;
    }
  }

  return vars;
}

/**
 * Prefer a fresh prepareAndRenderSms pass. Fall back to the stored body only
 * when re-render is impossible AND the stored text does not embed a >50-char
 * public title (the DLT failure mode this patch exists to stop).
 */
export async function resolveResendMessage(log: SmsLog): Promise<ResendBodyResult> {
  const templateId = log.template_id || "";
  const t = templateId ? await getTemplate(templateId) : null;

  if (t?.body_template) {
    const vars = await rebuildVarsFromLog(log);
    const defaults = await getResolvedDefaults(t.id);
    // Dynamic import avoids a circular dep with service.ts (which calls us).
    const { mergeSendVars } = await import("./service");
    const filled = mergeSendVars(t.id, defaults, vars);
    const rendered = prepareAndRenderSms(t.body_template, t.id, filled);
    if (rendered.ok) {
      return {
        ok: true,
        text: rendered.text,
        length: rendered.length,
        segments: rendered.segments,
        rerendered: true,
      };
    }
    const unsafe = await storedBodyLooksDltUnsafe(log.message_body);
    return {
      ok: false,
      skip: unsafe ? "stored_body_dlt_unsafe" : (rendered.blocked || "resend_rerender_failed"),
      detail:
        rendered.errors.join("; ") ||
        (rendered.missing.length ? `missing: ${rendered.missing.join(", ")}` : undefined),
    };
  }

  if (await storedBodyLooksDltUnsafe(log.message_body)) {
    return {
      ok: false,
      skip: "stored_body_dlt_unsafe",
      detail:
        "Stored body still has a >50-char free-text title. Use Mission Control Send with a fresh audience instead of Retry.",
    };
  }

  const guard = checkRenderedBody(log.message_body);
  if (!guard.ok) {
    return { ok: false, skip: `blocked_${guard.reason}`, detail: guard.detail || undefined };
  }

  return {
    ok: true,
    text: log.message_body,
    length: log.character_count || [...log.message_body].length,
    segments: log.segments || 1,
    rerendered: false,
  };
}
