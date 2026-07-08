import { randomUUID } from "crypto";
import type { FormField, FormFieldType, SystemFieldKey } from "./types";

/**
 * Normalise admin-submitted form-field definitions (the form builder output) into
 * clean, storable FormField objects. Defends the DB from malformed field configs.
 */

const FIELD_TYPES: FormFieldType[] = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "dropdown",
  "multiselect",
  "file",
];

const SYSTEM_KEYS: SystemFieldKey[] = [
  "full_name",
  "phone",
  "email",
  "city",
  "state",
  "subjects",
  "upsc_attempts",
  "interview_attempts",
  "salary_expectation",
  "upsc_roll_number",
  "resume",
  "marksheet",
  "proof",
];

function slugKey(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "").slice(0, 40);
}

export function sanitizeFormFields(input: unknown): FormField[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: FormField[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type = FIELD_TYPES.includes(r.type as FormFieldType) ? (r.type as FormFieldType) : "text";
    const label = String(r.label || "").trim().slice(0, 160) || "Question";
    let id = String(r.id || "").trim() || slugKey(label) || `field_${randomUUID().slice(0, 8)}`;
    id = slugKey(id) || `field_${randomUUID().slice(0, 8)}`;
    while (seen.has(id)) id = `${id}_${Math.floor(Math.random() * 1000)}`;
    seen.add(id);

    const field: FormField = {
      id,
      label,
      type,
      required: r.required === true,
      enabled: r.enabled !== false,
    };
    if (r.placeholder) field.placeholder = String(r.placeholder).slice(0, 160);
    if (r.help) field.help = String(r.help).slice(0, 300);
    if (SYSTEM_KEYS.includes(r.system as SystemFieldKey)) field.system = r.system as SystemFieldKey;

    if (type === "dropdown" || type === "multiselect") {
      const src = r.optionsSource;
      field.optionsSource = src === "subjects" || src === "states" ? src : "custom";
      if (field.optionsSource === "custom") {
        field.options = Array.isArray(r.options)
          ? r.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 100)
          : [];
      }
    }
    if (type === "file") {
      field.accept = Array.isArray(r.accept) ? r.accept.map((a) => String(a)).slice(0, 20) : undefined;
      field.maxFiles = Number(r.maxFiles) > 0 ? Math.min(5, Number(r.maxFiles)) : 1;
    }
    if (type === "number") {
      if (r.min != null && Number.isFinite(Number(r.min))) field.min = Number(r.min);
      if (r.max != null && Number.isFinite(Number(r.max))) field.max = Number(r.max);
    }
    out.push(field);
  }
  return out;
}

export function sanitizeSubjects(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of input) {
    const v = String(s || "").trim().slice(0, 60);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.slice(0, 100);
}
