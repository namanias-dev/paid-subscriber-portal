"use client";

import { ChevronUp, ChevronDown, Trash2, Plus, GripVertical } from "lucide-react";
import type { FormField, FormFieldType } from "@/lib/careers/types";

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Paragraph" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "dropdown", label: "Dropdown (single)" },
  { value: "multiselect", label: "Multi-select" },
  { value: "file", label: "File upload" },
];

function newField(): FormField {
  return {
    id: `field_${Math.random().toString(36).slice(2, 8)}`,
    label: "New question",
    type: "text",
    required: false,
    enabled: true,
  };
}

/**
 * Application form builder — add / edit / remove / reorder questions, toggle
 * required & enabled, choose field type and options. Reordering via up/down so it
 * works reliably on touch + keyboard. Core (system-mapped) fields are labelled.
 */
export default function FormBuilder({
  value,
  onChange,
}: {
  value: FormField[];
  onChange: (fields: FormField[]) => void;
}) {
  const fields = value || [];

  function update(idx: number, patch: Partial<FormField>) {
    onChange(fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }
  function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= fields.length) return;
    const copy = [...fields];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    onChange(copy);
  }
  function remove(idx: number) {
    onChange(fields.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...fields, newField()]);
  }

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <p className="rounded-lg bg-surface px-3 py-4 text-center text-sm text-ink2">
          No questions yet. Add your first question below.
        </p>
      )}

      {fields.map((f, idx) => (
        <div key={f.id} className="rounded-xl border border-line bg-surface2 p-3">
          <div className="flex items-start gap-2">
            <GripVertical size={16} className="mt-2.5 shrink-0 text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1"
                  value={f.label}
                  onChange={(e) => update(idx, { label: e.target.value })}
                  placeholder="Question label"
                />
                {f.system && <span className="pill pill-gray shrink-0">Core: {f.system}</span>}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input w-auto"
                  value={f.type}
                  onChange={(e) => update(idx, { type: e.target.value as FormFieldType })}
                  aria-label="Field type"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>

                <label className="flex items-center gap-1.5 text-sm text-ink2">
                  <input type="checkbox" checked={f.required} onChange={(e) => update(idx, { required: e.target.checked })} />
                  Required
                </label>
                <label className="flex items-center gap-1.5 text-sm text-ink2">
                  <input type="checkbox" checked={f.enabled} onChange={(e) => update(idx, { enabled: e.target.checked })} />
                  Enabled
                </label>
              </div>

              {(f.type === "dropdown" || f.type === "multiselect") && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input w-auto"
                    value={f.optionsSource || "custom"}
                    onChange={(e) => update(idx, { optionsSource: e.target.value as FormField["optionsSource"] })}
                    aria-label="Options source"
                  >
                    <option value="custom">Custom options</option>
                    <option value="subjects">Subject list</option>
                    <option value="states">Indian states</option>
                  </select>
                  {(f.optionsSource || "custom") === "custom" && (
                    <input
                      className="input flex-1"
                      placeholder="Comma-separated options (e.g. Yes, No, Maybe)"
                      value={(f.options || []).join(", ")}
                      onChange={(e) => update(idx, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                    />
                  )}
                </div>
              )}

              {f.type === "file" && (
                <div className="flex flex-wrap items-center gap-3 text-sm text-ink2">
                  <span>Max files:</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    className="input w-20"
                    value={f.maxFiles || 1}
                    onChange={(e) => update(idx, { maxFiles: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })}
                  />
                  <span className="text-xs text-muted">PDF / DOC / images accepted (max 10MB each)</span>
                </div>
              )}

              {f.type === "number" && (
                <div className="flex flex-wrap items-center gap-3 text-sm text-ink2">
                  <label className="flex items-center gap-1.5">Min
                    <input type="number" className="input w-24" value={f.min ?? ""} onChange={(e) => update(idx, { min: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  </label>
                  <label className="flex items-center gap-1.5">Max
                    <input type="number" className="input w-24" value={f.max ?? ""} onChange={(e) => update(idx, { max: e.target.value === "" ? undefined : Number(e.target.value) })} />
                  </label>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input" placeholder="Placeholder (optional)" value={f.placeholder || ""} onChange={(e) => update(idx, { placeholder: e.target.value })} />
                <input className="input" placeholder="Help text (optional)" value={f.help || ""} onChange={(e) => update(idx, { help: e.target.value })} />
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-1">
              <button type="button" className="rounded-lg p-1 text-muted hover:bg-surface hover:text-ink disabled:opacity-30" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move up">
                <ChevronUp size={16} />
              </button>
              <button type="button" className="rounded-lg p-1 text-muted hover:bg-surface hover:text-ink disabled:opacity-30" onClick={() => move(idx, 1)} disabled={idx === fields.length - 1} aria-label="Move down">
                <ChevronDown size={16} />
              </button>
              <button type="button" className="rounded-lg p-1 text-muted hover:bg-danger/10 hover:text-danger" onClick={() => remove(idx)} aria-label="Remove">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>
      ))}

      <button type="button" className="btn btn-secondary w-full" onClick={add}>
        <Plus size={16} /> Add question
      </button>
    </div>
  );
}
