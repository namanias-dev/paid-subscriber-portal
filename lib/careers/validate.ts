import { normalizeIndianMobile } from "@/lib/phone";
import { isCareerFileKey } from "./storage";
import { INDIAN_STATES, CAREER_MAX_UPLOAD_BYTES } from "./config";
import type { CareerApplication, FormField, UploadedFileMeta } from "./types";

/**
 * Server-side validation for a public application submission. Never trusts the
 * client: every enabled field is re-validated here, files are re-checked against
 * the private-key allowlist, and only whitelisted values are persisted.
 */

export interface ApplyPayload {
  answers?: Record<string, unknown>;
  files?: UploadedFileMeta[];
  honeypot?: string;
}

export interface ValidateResult {
  ok: boolean;
  error?: string;
  record?: Partial<CareerApplication>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 2000;

function fieldOptions(field: FormField, subjects: string[]): string[] {
  if (field.optionsSource === "subjects") return subjects;
  if (field.optionsSource === "states") return INDIAN_STATES;
  return field.options || [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export function validateApplication(
  fields: FormField[],
  subjects: string[],
  payload: ApplyPayload,
): ValidateResult {
  // Honeypot: real users never fill a hidden field.
  if (str(payload.honeypot)) return { ok: false, error: "Submission rejected." };

  const answers = (payload.answers && typeof payload.answers === "object" ? payload.answers : {}) as Record<string, unknown>;
  const files = Array.isArray(payload.files) ? payload.files : [];

  const record: Partial<CareerApplication> = {
    subjects: [],
    answers: {},
    files: [],
  };
  const customAnswers: Record<string, unknown> = {};
  const acceptedFiles: UploadedFileMeta[] = [];

  for (const f of fields) {
    if (!f.enabled) continue;
    const raw = answers[f.id];

    // ---- File fields --------------------------------------------------------
    if (f.type === "file") {
      const matches = files.filter((x) => x && x.field === f.id && isCareerFileKey(String(x.key)));
      if (matches.length === 0) {
        if (f.required) return { ok: false, error: `Please upload: ${f.label}.` };
        continue;
      }
      const max = f.maxFiles && f.maxFiles > 0 ? f.maxFiles : 1;
      for (const m of matches.slice(0, max)) {
        const ct = str(m.content_type).toLowerCase();
        if (f.accept && f.accept.length && !f.accept.includes(ct)) {
          return { ok: false, error: `Unsupported file type for ${f.label}.` };
        }
        if (Number(m.size) > CAREER_MAX_UPLOAD_BYTES) {
          return { ok: false, error: `${f.label} is too large (max 10MB).` };
        }
        acceptedFiles.push({
          field: f.id,
          key: String(m.key),
          name: str(m.name).slice(0, 180) || "file",
          content_type: ct,
          size: Number(m.size) || 0,
          uploaded_at: str(m.uploaded_at) || new Date().toISOString(),
        });
      }
      continue;
    }

    // ---- Multiselect (subjects & custom) -----------------------------------
    if (f.type === "multiselect") {
      const opts = fieldOptions(f, subjects);
      const arr = Array.isArray(raw) ? raw.map(str).filter(Boolean) : [];
      const valid = arr.filter((v) => opts.includes(v)).slice(0, 50);
      if (f.required && valid.length === 0) return { ok: false, error: `Please select: ${f.label}.` };
      if (f.system === "subjects") record.subjects = valid;
      else customAnswers[f.id] = valid;
      continue;
    }

    // ---- Everything scalar --------------------------------------------------
    const value = str(raw);
    if (!value) {
      if (f.required) return { ok: false, error: `Please fill in: ${f.label}.` };
      continue;
    }

    if (f.type === "email") {
      if (!EMAIL_RE.test(value) || value.length > 200) return { ok: false, error: "Enter a valid email address." };
      if (f.system === "email") record.email = value.toLowerCase();
      else customAnswers[f.id] = value.toLowerCase();
      continue;
    }

    if (f.type === "phone") {
      const n = normalizeIndianMobile(value);
      if (!n.ok || !n.digits10) return { ok: false, error: n.error || "Enter a valid 10-digit mobile number." };
      if (f.system === "phone") record.phone = n.digits10;
      else customAnswers[f.id] = n.digits10;
      continue;
    }

    if (f.type === "number") {
      const num = Number(value.replace(/[, ]+/g, ""));
      if (!Number.isFinite(num)) return { ok: false, error: `${f.label} must be a number.` };
      if (f.min != null && num < f.min) return { ok: false, error: `${f.label} must be at least ${f.min}.` };
      if (f.max != null && num > f.max) return { ok: false, error: `${f.label} must be at most ${f.max}.` };
      switch (f.system) {
        case "upsc_attempts": record.upsc_attempts = num; break;
        case "interview_attempts": record.interview_attempts = num; break;
        case "salary_expectation": record.salary_expectation = num; break;
        default: customAnswers[f.id] = num;
      }
      continue;
    }

    if (f.type === "dropdown") {
      const opts = fieldOptions(f, subjects);
      if (opts.length && !opts.includes(value)) return { ok: false, error: `Choose a valid option for ${f.label}.` };
      assignScalar(record, customAnswers, f, value);
      continue;
    }

    // text / textarea
    if (value.length > MAX_TEXT) return { ok: false, error: `${f.label} is too long.` };
    assignScalar(record, customAnswers, f, value);
  }

  // Core requirements that must always exist regardless of form config.
  if (!record.full_name) return { ok: false, error: "Please enter your full name." };
  if (!record.phone) return { ok: false, error: "Please enter a valid phone number." };
  if (!record.email) return { ok: false, error: "Please enter a valid email address." };

  record.answers = customAnswers;
  record.files = acceptedFiles;
  return { ok: true, record };
}

function assignScalar(
  record: Partial<CareerApplication>,
  custom: Record<string, unknown>,
  f: FormField,
  value: string,
): void {
  switch (f.system) {
    case "full_name": record.full_name = value.slice(0, 200); break;
    case "city": record.city = value.slice(0, 120); break;
    case "state": record.state = value.slice(0, 120); break;
    case "upsc_roll_number": record.upsc_roll_number = value.slice(0, 60); break;
    default: custom[f.id] = value;
  }
}
