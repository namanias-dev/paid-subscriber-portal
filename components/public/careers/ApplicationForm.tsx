"use client";

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Upload, X, Loader2, FileText } from "lucide-react";
import { INDIAN_STATES, CAREER_MAX_UPLOAD_BYTES } from "@/lib/careers/config";
import type { FormField, PublicPosition, UploadedFileMeta } from "@/lib/careers/types";

const PAGE_SIZE = 4;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Values = Record<string, string | string[]>;
type FileState = Record<string, { uploading: boolean; error?: string; meta?: UploadedFileMeta }>;

function newUploadId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `up-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export default function ApplicationForm({ position, subjects }: { position: PublicPosition; subjects: string[] }) {
  const fields = position.form_fields;
  const [uploadId] = useState(newUploadId);
  const [values, setValues] = useState<Values>({});
  const [files, setFiles] = useState<FileState>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const honeypotRef = useRef<HTMLInputElement>(null);

  const pages = useMemo(() => chunk(fields, PAGE_SIZE), [fields]);
  const totalSteps = pages.length; // review is folded into the last step's submit
  const currentFields = pages[step] || [];

  function optionsFor(f: FormField): string[] {
    if (f.optionsSource === "subjects") return subjects;
    if (f.optionsSource === "states") return INDIAN_STATES;
    return f.options || [];
  }

  function setValue(id: string, v: string | string[]) {
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => (prev[id] ? { ...prev, [id]: "" } : prev));
  }

  function validateField(f: FormField): string {
    if (f.type === "file") {
      const st = files[f.id];
      if (f.required && !st?.meta) return `Please upload ${f.label}.`;
      return "";
    }
    if (f.type === "multiselect") {
      const arr = (values[f.id] as string[]) || [];
      if (f.required && arr.length === 0) return `Please select ${f.label}.`;
      return "";
    }
    const val = ((values[f.id] as string) || "").trim();
    if (!val) return f.required ? `Please fill in ${f.label}.` : "";
    if (f.type === "email" && !EMAIL_RE.test(val)) return "Enter a valid email address.";
    if (f.type === "phone" && val.replace(/\D/g, "").replace(/^(0|91)/, "").length !== 10)
      return "Enter a valid 10-digit mobile number.";
    if (f.type === "number") {
      const n = Number(val.replace(/[, ]+/g, ""));
      if (!Number.isFinite(n)) return `${f.label} must be a number.`;
      if (f.min != null && n < f.min) return `${f.label} must be at least ${f.min}.`;
      if (f.max != null && n > f.max) return `${f.label} must be at most ${f.max}.`;
    }
    return "";
  }

  function validatePage(idx: number): boolean {
    const errs: Record<string, string> = {};
    for (const f of pages[idx] || []) {
      const e = validateField(f);
      if (e) errs[f.id] = e;
    }
    setErrors((prev) => ({ ...prev, ...errs }));
    return Object.keys(errs).length === 0;
  }

  function next() {
    if (!validatePage(step)) return;
    setStep((s) => Math.min(totalSteps - 1, s + 1));
  }
  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  async function handleFile(f: FormField, file: File | null) {
    if (!file) return;
    if (file.size > CAREER_MAX_UPLOAD_BYTES) {
      setFiles((prev) => ({ ...prev, [f.id]: { uploading: false, error: "File is too large (max 10MB)." } }));
      return;
    }
    if (f.accept && f.accept.length && !f.accept.includes(file.type)) {
      setFiles((prev) => ({ ...prev, [f.id]: { uploading: false, error: "Unsupported file type." } }));
      return;
    }
    setFiles((prev) => ({ ...prev, [f.id]: { uploading: true } }));
    setErrors((prev) => (prev[f.id] ? { ...prev, [f.id]: "" } : prev));
    try {
      const signRes = await fetch("/api/public/careers/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, field: f.id, fileName: file.name, contentType: file.type, size: file.size }),
      });
      const signed = await signRes.json();
      if (!signed.ok) throw new Error(signed.error || "Upload failed.");
      const put = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Upload failed. Please try again.");
      setFiles((prev) => ({ ...prev, [f.id]: { uploading: false, meta: signed.file as UploadedFileMeta } }));
    } catch (e) {
      setFiles((prev) => ({ ...prev, [f.id]: { uploading: false, error: (e as Error).message } }));
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }

  async function submit() {
    if (honeypotRef.current?.value) return; // bot
    // Validate every page before submit.
    for (let i = 0; i < totalSteps; i += 1) {
      if (!validatePage(i)) {
        setStep(i);
        return;
      }
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const answers: Record<string, unknown> = {};
      for (const f of fields) {
        if (f.type === "file") continue;
        const v = values[f.id];
        if (v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) answers[f.id] = v;
      }
      const fileList = Object.values(files)
        .map((s) => s.meta)
        .filter(Boolean) as UploadedFileMeta[];

      const res = await fetch("/api/public/careers/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: position.slug,
          answers,
          files: fileList,
          honeypot: honeypotRef.current?.value || "",
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Could not submit. Please try again.");
      setDone(true);
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 size={30} aria-hidden="true" />
        </span>
        <h3 className="font-heading text-xl font-bold text-ink">Application submitted!</h3>
        <p className="mt-2 text-sm text-ink2">
          Thank you for applying for <b>{position.title}</b>. Our team will review your application and
          reach out if there&apos;s a match. You&apos;ll receive a confirmation email shortly.
        </p>
        <a href="/careers" className="btn btn-secondary mt-5 w-full">Browse more roles</a>
      </div>
    );
  }

  const isLastStep = step === totalSteps - 1;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-heading text-lg font-bold">Apply for this role</h3>
        <span className="text-xs font-semibold text-muted">Step {step + 1} of {totalSteps}</span>
      </div>
      {/* Progress bar */}
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
        />
      </div>

      {/* Honeypot (hidden from humans) */}
      <input
        ref={honeypotRef}
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <div className="space-y-4">
        {currentFields.map((f) => (
          <FieldRow
            key={f.id}
            field={f}
            value={values[f.id]}
            error={errors[f.id]}
            options={optionsFor(f)}
            fileState={files[f.id]}
            onChange={(v) => setValue(f.id, v)}
            onFile={(file) => handleFile(f, file)}
            onRemoveFile={() => removeFile(f.id)}
          />
        ))}
      </div>

      {submitError && (
        <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{submitError}</p>
      )}

      <div className="mt-6 flex gap-3">
        {step > 0 && (
          <button type="button" className="btn btn-ghost flex-1" onClick={back} disabled={submitting}>
            Back
          </button>
        )}
        {!isLastStep ? (
          <button type="button" className="btn btn-primary flex-1" onClick={next}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn btn-primary flex-1" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 size={18} className="animate-spin" /> : "Submit application"}
          </button>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        Your details are shared only with the Naman IAS hiring team.
      </p>
    </div>
  );
}

function FieldRow({
  field,
  value,
  error,
  options,
  fileState,
  onChange,
  onFile,
  onRemoveFile,
}: {
  field: FormField;
  value: string | string[] | undefined;
  error?: string;
  options: string[];
  fileState?: { uploading: boolean; error?: string; meta?: UploadedFileMeta };
  onChange: (v: string | string[]) => void;
  onFile: (file: File | null) => void;
  onRemoveFile: () => void;
}) {
  const id = `f_${field.id}`;
  return (
    <div>
      <label htmlFor={id} className="label">
        {field.label} {field.required && <span className="text-danger">*</span>}
      </label>

      {field.type === "textarea" ? (
        <textarea
          id={id}
          className="input min-h-[96px]"
          placeholder={field.placeholder}
          value={(value as string) || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "dropdown" ? (
        <select id={id} className="input" value={(value as string) || ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : field.type === "multiselect" ? (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => {
            const arr = (value as string[]) || [];
            const active = arr.includes(o);
            return (
              <button
                key={o}
                type="button"
                className={`chip ${active ? "chip-active" : ""}`}
                aria-pressed={active}
                onClick={() => onChange(active ? arr.filter((x) => x !== o) : [...arr, o])}
              >
                {o}
              </button>
            );
          })}
        </div>
      ) : field.type === "file" ? (
        <FileInput id={id} field={field} state={fileState} onFile={onFile} onRemove={onRemoveFile} />
      ) : (
        <input
          id={id}
          type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          inputMode={field.type === "number" ? "numeric" : field.type === "phone" ? "tel" : undefined}
          className="input"
          placeholder={field.placeholder}
          value={(value as string) || ""}
          min={field.type === "number" ? field.min : undefined}
          max={field.type === "number" ? field.max : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.help && !error && <p className="mt-1 text-xs text-muted">{field.help}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

function FileInput({
  id,
  field,
  state,
  onFile,
  onRemove,
}: {
  id: string;
  field: FormField;
  state?: { uploading: boolean; error?: string; meta?: UploadedFileMeta };
  onFile: (file: File | null) => void;
  onRemove: () => void;
}) {
  const accept = field.accept && field.accept.length ? field.accept.join(",") : undefined;
  if (state?.meta) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-line bg-surface2 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
          <FileText size={16} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">{state.meta.name}</span>
        </span>
        <button type="button" onClick={onRemove} className="ml-2 text-muted hover:text-danger" aria-label="Remove file">
          <X size={16} />
        </button>
      </div>
    );
  }
  return (
    <div>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface2 px-3 py-3 text-sm text-ink2 transition hover:border-primary hover:text-primary"
      >
        {state?.uploading ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Uploading…
          </>
        ) : (
          <>
            <Upload size={16} /> Choose file
          </>
        )}
        <input
          id={id}
          type="file"
          className="hidden"
          accept={accept}
          disabled={state?.uploading}
          onChange={(e) => onFile(e.target.files?.[0] || null)}
        />
      </label>
      {state?.error && <p className="mt-1 text-xs text-danger">{state.error}</p>}
    </div>
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
