"use client";

import { useMemo } from "react";
import { SendHorizontal, AlertTriangle, Info } from "lucide-react";
import type { AutomationTemplateOption } from "@/types/journey-automation";

export interface InspectorNode {
  node_key: string;
  type: string;
  config: Record<string, unknown>;
}

interface Props {
  node: InspectorNode | null;
  templates: AutomationTemplateOption[];
  canEdit: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}

function estimateParts(body: string): number {
  const len = body.length;
  if (len === 0) return 0;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

export default function NodeInspector({ node, templates, canEdit, onChange, onDelete }: Props) {
  const cfg = node?.config ?? {};
  const disabled = !canEdit;

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === cfg.automationTemplateId),
    [templates, cfg.automationTemplateId],
  );

  if (!node) {
    return (
      <div className="ja-panel ja-panel-right p-5">
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Info size={22} className="text-muted" aria-hidden="true" />
          <p className="text-sm font-semibold">Nothing selected</p>
          <p className="max-w-[220px] text-xs text-muted">Select a node on the canvas to configure it, or drag a node from the library.</p>
        </div>
      </div>
    );
  }

  const set = (patch: Record<string, unknown>) => { if (!disabled) onChange(patch); };

  return (
    <div className="ja-panel ja-panel-right p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-heading text-sm font-bold capitalize">{String(node.type).replace(/_/g, " ")}</h3>
        <button type="button" className="ja-btn-sm" data-variant="danger" onClick={onDelete} disabled={disabled}>Delete</button>
      </div>

      <div className="ja-field">
        <label className="ja-insp-label">Title</label>
        <input className="ja-input" value={String(cfg.title ?? "")} disabled={disabled} onChange={(e) => set({ title: e.target.value })} />
      </div>

      {node.type === "trigger" && (
        <>
          <div className="ja-field">
            <label className="ja-insp-label">Event</label>
            <div className="ja-preview">{String(cfg.eventType ?? "—")}</div>
          </div>
          <p className="text-xs text-muted">This trigger fires when the event is captured. Nothing enrols yet — execution is disabled.</p>
        </>
      )}

      {node.type === "wait" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="ja-field">
            <label className="ja-insp-label">Duration</label>
            <input type="number" min={1} className="ja-input" value={Number(cfg.durationValue ?? 1)} disabled={disabled} onChange={(e) => set({ durationValue: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <div className="ja-field">
            <label className="ja-insp-label">Unit</label>
            <select className="ja-select" value={String(cfg.durationUnit ?? "days")} disabled={disabled} onChange={(e) => set({ durationUnit: e.target.value })}>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
        </div>
      )}

      {node.type === "condition" && (
        <>
          <div className="ja-field">
            <label className="ja-insp-label">Field</label>
            <input className="ja-input" placeholder="e.g. payment_status" value={String(cfg.field ?? "")} disabled={disabled} onChange={(e) => set({ field: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="ja-field">
              <label className="ja-insp-label">Operator</label>
              <select className="ja-select" value={String(cfg.operator ?? "eq")} disabled={disabled} onChange={(e) => set({ operator: e.target.value })}>
                <option value="eq">equals</option>
                <option value="neq">not equals</option>
                <option value="gt">greater than</option>
                <option value="lt">less than</option>
                <option value="contains">contains</option>
              </select>
            </div>
            <div className="ja-field">
              <label className="ja-insp-label">Value</label>
              <input className="ja-input" value={String(cfg.value ?? "")} disabled={disabled} onChange={(e) => set({ value: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted">Connect the <b>yes</b> and <b>no</b> edges from this node to define both paths.</p>
        </>
      )}

      {node.type === "staff_task" && (
        <>
          <div className="ja-field">
            <label className="ja-insp-label">Assignee</label>
            <input className="ja-input" placeholder="Team or person" value={String(cfg.assignee ?? "")} disabled={disabled} onChange={(e) => set({ assignee: e.target.value })} />
          </div>
          <div className="ja-field">
            <label className="ja-insp-label">Details</label>
            <textarea className="ja-textarea" value={String(cfg.details ?? "")} disabled={disabled} onChange={(e) => set({ details: e.target.value })} />
          </div>
        </>
      )}

      {node.type === "goal" && (
        <div className="ja-field">
          <label className="ja-insp-label">Goal type</label>
          <select className="ja-select" value={String(cfg.goalType ?? "payment_completed")} disabled={disabled} onChange={(e) => set({ goalType: e.target.value })}>
            <option value="payment_completed">Payment completed</option>
            <option value="webinar_attended">Webinar attended</option>
            <option value="course_enrolled">Course enrolled</option>
            <option value="custom">Custom</option>
          </select>
        </div>
      )}

      {node.type === "send_sms" && (
        <SmsInspector cfg={cfg} templates={templates} selectedTemplate={selectedTemplate} disabled={disabled} set={set} />
      )}
    </div>
  );
}

function SmsInspector({ cfg, templates, selectedTemplate, disabled, set }: {
  cfg: Record<string, unknown>;
  templates: AutomationTemplateOption[];
  selectedTemplate: AutomationTemplateOption | undefined;
  disabled: boolean;
  set: (p: Record<string, unknown>) => void;
}) {
  const variables = Array.isArray(cfg.templateVariables) ? (cfg.templateVariables as string[]) : (selectedTemplate?.variables ?? []);
  const mapping = (cfg.variableMapping && typeof cfg.variableMapping === "object" ? cfg.variableMapping : {}) as Record<string, string>;
  const quietHours = (cfg.quietHours && typeof cfg.quietHours === "object" ? cfg.quietHours : { start: "21:00", end: "08:00" }) as { start: string; end: string };
  const freq = (cfg.frequencyCap && typeof cfg.frequencyCap === "object" ? cfg.frequencyCap : { perDays: 1, max: 1 }) as { perDays: number; max: number };
  const body = selectedTemplate?.body ?? "";
  const missing = variables.filter((v) => !mapping[v] || String(mapping[v]).trim() === "");

  function selectTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    set({ automationTemplateId: id || null, smsTemplateId: t?.sms_template_id ?? null, templateName: t?.name ?? null, templateVariables: t?.variables ?? [], body: t?.body ?? "" });
  }

  return (
    <>
      <div className="ja-field">
        <label className="ja-insp-label">Approved DLT template</label>
        <select className="ja-select" value={String(cfg.automationTemplateId ?? "")} disabled={disabled} onChange={(e) => selectTemplate(e.target.value)}>
          <option value="">Select a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id} disabled={!t.approved}>
              {t.name}{t.approved ? "" : " (not approved)"}
            </option>
          ))}
        </select>
        {templates.length === 0 && <p className="mt-1 text-xs text-muted">No journey templates yet. Add DLT-approved templates to enable SMS nodes.</p>}
        {selectedTemplate && (
          <p className="mt-1 text-[11px] text-muted">DLT: {selectedTemplate.dlt_template_id ?? "—"} · {selectedTemplate.approved ? "Approved" : "Not approved"}</p>
        )}
      </div>

      {selectedTemplate && (
        <>
          <div className="ja-field">
            <label className="ja-insp-label">Preview</label>
            <div className="ja-preview">{body || "(empty template)"}</div>
            <p className="mt-1 text-[11px] text-muted">Estimated SMS parts: {estimateParts(body)}</p>
          </div>

          {variables.length > 0 && (
            <div className="ja-field">
              <label className="ja-insp-label">Variable mapping</label>
              {variables.map((v) => (
                <div key={v} className="mb-1.5 flex items-center gap-2">
                  <code className="min-w-[92px] text-[11px] text-ink2">{`{${v}}`}</code>
                  <input
                    className="ja-input"
                    placeholder="source e.g. student.name"
                    value={mapping[v] ?? ""}
                    disabled={disabled}
                    onChange={(e) => set({ variableMapping: { ...mapping, [v]: e.target.value } })}
                  />
                </div>
              ))}
              {missing.length > 0 && (
                <p className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: "var(--danger)" }}>
                  <AlertTriangle size={12} aria-hidden="true" /> Missing mapping: {missing.join(", ")}
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="ja-field">
          <label className="ja-insp-label">Quiet hours start</label>
          <input type="time" className="ja-input" value={quietHours.start} disabled={disabled} onChange={(e) => set({ quietHours: { ...quietHours, start: e.target.value } })} />
        </div>
        <div className="ja-field">
          <label className="ja-insp-label">Quiet hours end</label>
          <input type="time" className="ja-input" value={quietHours.end} disabled={disabled} onChange={(e) => set({ quietHours: { ...quietHours, end: e.target.value } })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="ja-field">
          <label className="ja-insp-label">Frequency cap (max)</label>
          <input type="number" min={1} className="ja-input" value={Number(freq.max ?? 1)} disabled={disabled} onChange={(e) => set({ frequencyCap: { ...freq, max: Math.max(1, Number(e.target.value) || 1) } })} />
        </div>
        <div className="ja-field">
          <label className="ja-insp-label">per (days)</label>
          <input type="number" min={1} className="ja-input" value={Number(freq.perDays ?? 1)} disabled={disabled} onChange={(e) => set({ frequencyCap: { ...freq, perDays: Math.max(1, Number(e.target.value) || 1) } })} />
        </div>
      </div>

      {/* Disabled test-send affordance — must NOT be wired to any real send. */}
      <div className="ja-field">
        <button type="button" className="btn btn-ghost w-full cursor-not-allowed opacity-60" disabled title="Available when execution is enabled">
          <SendHorizontal size={14} aria-hidden="true" /> Test send
        </button>
        <p className="mt-1 text-center text-[11px] text-muted">Available when execution is enabled.</p>
      </div>
    </>
  );
}
