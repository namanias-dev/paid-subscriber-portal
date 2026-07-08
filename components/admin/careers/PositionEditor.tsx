"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import RichTextEditor from "@/components/admin/RichTextEditor";
import FormBuilder from "./FormBuilder";
import { useToast } from "@/components/ui/Toast";
import { INDIAN_STATES, JOB_TYPES, JOB_TYPE_LABELS, ROLE_TYPES, ROLE_TYPE_LABELS } from "@/lib/careers/config";
import type { CareerPosition, FormField } from "@/lib/careers/types";

interface Draft {
  title: string;
  slug: string;
  role_type: string;
  location_city: string;
  location_state: string;
  job_type: string;
  salary_min: string;
  salary_max: string;
  salary_period: "month" | "year";
  subjects: string[];
  summary: string;
  description_html: string;
  requirements_html: string;
  status: "draft" | "open" | "closed";
  accepting_applications: boolean;
  form_fields: FormField[];
}

function toDraft(p: CareerPosition | null): Draft {
  return {
    title: p?.title || "",
    slug: p?.slug || "",
    role_type: p?.role_type || "faculty",
    location_city: p?.location_city || "",
    location_state: p?.location_state || "",
    job_type: p?.job_type || "full_time",
    salary_min: p?.salary_min != null ? String(p.salary_min) : "",
    salary_max: p?.salary_max != null ? String(p.salary_max) : "",
    salary_period: p?.salary_period || "month",
    subjects: p?.subjects || [],
    summary: p?.summary || "",
    description_html: p?.description_html || "",
    requirements_html: p?.requirements_html || "",
    status: p?.status || "draft",
    accepting_applications: p?.accepting_applications ?? true,
    form_fields: p?.form_fields || [],
  };
}

export default function PositionEditor({
  open,
  onClose,
  position,
  subjects,
  defaultFormFields,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  position: CareerPosition | null;
  subjects: string[];
  defaultFormFields: FormField[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(position));
  const [saving, setSaving] = useState(false);
  const [customForm, setCustomForm] = useState<boolean>((position?.form_fields?.length ?? 0) > 0);

  useEffect(() => {
    if (open) {
      setDraft(toDraft(position));
      setCustomForm((position?.form_fields?.length ?? 0) > 0);
    }
  }, [open, position]);

  function set<K extends keyof Draft>(key: K, val: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function toggleSubject(s: string) {
    setDraft((d) => ({
      ...d,
      subjects: d.subjects.includes(s) ? d.subjects.filter((x) => x !== s) : [...d.subjects, s],
    }));
  }

  async function save() {
    if (!draft.title.trim()) {
      toast("Please enter a title.", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: draft.title,
        slug: draft.slug || undefined,
        role_type: draft.role_type,
        location_city: draft.location_city,
        location_state: draft.location_state,
        job_type: draft.job_type,
        salary_min: draft.salary_min === "" ? null : Number(draft.salary_min),
        salary_max: draft.salary_max === "" ? null : Number(draft.salary_max),
        salary_period: draft.salary_period,
        subjects: draft.subjects,
        summary: draft.summary,
        description_html: draft.description_html,
        requirements_html: draft.requirements_html,
        status: draft.status,
        accepting_applications: draft.accepting_applications,
        // Empty array => "use the global default template" on the public side.
        form_fields: customForm ? draft.form_fields : [],
      };
      const url = position ? `/api/admin/careers/positions/${position.id}` : "/api/admin/careers/positions";
      const res = await fetch(url, {
        method: position ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Save failed.");
      toast(position ? "Position updated." : "Position created.", "success");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={position ? "Edit position" : "New position"} maxWidth="max-w-3xl">
      <div className="space-y-5">
        {/* Basics */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Title *</label>
            <input className="input" value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. UPSC Faculty" />
          </div>
          <div>
            <label className="label">Role type</label>
            <select className="input" value={draft.role_type} onChange={(e) => set("role_type", e.target.value)}>
              {ROLE_TYPES.map((r) => (
                <option key={r} value={r}>{ROLE_TYPE_LABELS[r] || r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Job type</label>
            <select className="input" value={draft.job_type} onChange={(e) => set("job_type", e.target.value)}>
              {JOB_TYPES.map((j) => (
                <option key={j} value={j}>{JOB_TYPE_LABELS[j]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={draft.location_city} onChange={(e) => set("location_city", e.target.value)} placeholder="e.g. Chandigarh" />
          </div>
          <div>
            <label className="label">State</label>
            <select className="input" value={draft.location_state} onChange={(e) => set("location_state", e.target.value)}>
              <option value="">Select…</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Salary */}
        <div>
          <label className="label">Salary range (₹)</label>
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" className="input w-32" placeholder="Min" value={draft.salary_min} onChange={(e) => set("salary_min", e.target.value)} />
            <span className="text-ink2">–</span>
            <input type="number" className="input w-32" placeholder="Max" value={draft.salary_max} onChange={(e) => set("salary_max", e.target.value)} />
            <select className="input w-auto" value={draft.salary_period} onChange={(e) => set("salary_period", e.target.value as "month" | "year")}>
              <option value="month">per month</option>
              <option value="year">per year</option>
            </select>
          </div>
          {/* NOTE(owner): confirm the exact salary UPPER BOUND for UPSC Faculty. */}
          <p className="mt-1 text-xs text-muted">Leave a field blank to show &quot;From ₹X&quot; or &quot;Up to ₹Y&quot;. Set the exact upper bound here.</p>
        </div>

        {/* Subjects */}
        <div>
          <label className="label">Subjects</label>
          {subjects.length === 0 ? (
            <p className="text-sm text-muted">Add subjects in Settings first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {subjects.map((s) => (
                <button key={s} type="button" className={`chip ${draft.subjects.includes(s) ? "chip-active" : ""}`} onClick={() => toggleSubject(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Summary */}
        <div>
          <label className="label">Short summary (card blurb)</label>
          <textarea className="input min-h-[70px]" value={draft.summary} onChange={(e) => set("summary", e.target.value)} placeholder="One or two lines shown on the careers list." />
        </div>

        {/* Description */}
        <div>
          <label className="label">Description</label>
          <RichTextEditor value={draft.description_html} onChange={(html) => set("description_html", html)} placeholder="Role overview, responsibilities…" />
        </div>

        {/* Requirements */}
        <div>
          <label className="label">Requirements</label>
          <RichTextEditor value={draft.requirements_html} onChange={(html) => set("requirements_html", html)} placeholder="Qualifications, experience…" />
        </div>

        {/* Status */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Status</label>
            <select className="input" value={draft.status} onChange={(e) => set("status", e.target.value as Draft["status"])}>
              <option value="draft">Draft (hidden)</option>
              <option value="open">Open (public)</option>
              <option value="closed">Closed (visible, no apply)</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-ink2">
              <input type="checkbox" checked={draft.accepting_applications} onChange={(e) => set("accepting_applications", e.target.checked)} />
              Accepting applications for this role
            </label>
          </div>
        </div>

        {/* Form builder */}
        <div className="rounded-xl border border-line p-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={customForm}
              onChange={(e) => {
                setCustomForm(e.target.checked);
                if (e.target.checked && draft.form_fields.length === 0) {
                  set("form_fields", defaultFormFields.map((f) => ({ ...f })));
                }
              }}
            />
            Customize the application form for this role
          </label>
          <p className="mt-1 text-xs text-muted">
            {customForm
              ? "This role uses its own questions below."
              : "This role uses the global default application form (edit it in Settings)."}
          </p>
          {customForm && (
            <div className="mt-3">
              <FormBuilder value={draft.form_fields} onChange={(fields) => set("form_fields", fields)} />
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary flex-1" onClick={save} disabled={saving}>
            {saving ? "Saving…" : position ? "Save changes" : "Create position"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
