import { sanitizeHtml } from "@/lib/sanitizeHtml";
import { sanitizeFormFields, sanitizeSubjects } from "./formFields";
import { JOB_TYPES } from "./config";
import type { CareerPosition, CareerJobType, CareerStatus, CareerSalaryPeriod } from "./types";

/**
 * Normalise an admin-submitted position payload into a safe partial for create/
 * update. Rich text is sanitized; only known enums pass through; numbers coerced.
 */
export function normalizePositionInput(body: Record<string, unknown>): Partial<CareerPosition> {
  const out: Partial<CareerPosition> = {};

  if (body.title !== undefined) out.title = String(body.title || "").trim().slice(0, 200);
  if (body.slug !== undefined) out.slug = String(body.slug || "").trim().slice(0, 200);
  if (body.role_type !== undefined) out.role_type = String(body.role_type || "faculty").trim().slice(0, 40) || "faculty";

  if (body.location_city !== undefined) out.location_city = strOrNull(body.location_city, 120);
  if (body.location_state !== undefined) out.location_state = strOrNull(body.location_state, 120);

  if (body.job_type !== undefined) {
    out.job_type = (JOB_TYPES.includes(body.job_type as CareerJobType) ? body.job_type : "full_time") as CareerJobType;
  }

  if (body.salary_min !== undefined) out.salary_min = numOrNull(body.salary_min);
  if (body.salary_max !== undefined) out.salary_max = numOrNull(body.salary_max);
  if (body.salary_currency !== undefined) out.salary_currency = String(body.salary_currency || "INR").trim().slice(0, 8) || "INR";
  if (body.salary_period !== undefined) {
    out.salary_period = (body.salary_period === "year" ? "year" : "month") as CareerSalaryPeriod;
  }

  if (body.subjects !== undefined) out.subjects = sanitizeSubjects(body.subjects);
  if (body.summary !== undefined) out.summary = strOrNull(body.summary, 400);
  if (body.description_html !== undefined) {
    out.description_html = body.description_html ? sanitizeHtml(String(body.description_html)) || null : null;
  }
  if (body.requirements_html !== undefined) {
    out.requirements_html = body.requirements_html ? sanitizeHtml(String(body.requirements_html)) || null : null;
  }

  if (body.status !== undefined) {
    const s = String(body.status);
    out.status = (["draft", "open", "closed"].includes(s) ? s : "draft") as CareerStatus;
  }
  if (body.accepting_applications !== undefined) out.accepting_applications = body.accepting_applications !== false;
  if (body.form_fields !== undefined) out.form_fields = sanitizeFormFields(body.form_fields);
  if (body.display_order !== undefined) out.display_order = Number(body.display_order) || 0;

  return out;
}

function strOrNull(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[, ]+/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}
