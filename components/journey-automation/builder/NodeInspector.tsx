"use client";

import { useMemo } from "react";
import { SendHorizontal, AlertTriangle, Info, Plus, Trash2, ExternalLink, HelpCircle, Filter } from "lucide-react";
import Link from "next/link";
import type { AutomationTemplateOption } from "@/types/journey-automation";
import { CONDITION_CHECKS, SMS_CATEGORIES, GOAL_TYPES, JOURNEY_VARIABLES } from "./nodeCatalog";
import { TRIGGER_FILTER_DIMS, readTriggerFilters, type TriggerSources } from "@/lib/journey-automation/engine/triggerMatch";

export interface InspectorNode {
  node_key: string;
  type: string;
  config: Record<string, unknown>;
}

interface Props {
  node: InspectorNode | null;
  templates: AutomationTemplateOption[];
  triggerSources?: TriggerSources;
  canEdit: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}

function estimateParts(body: string): number {
  const len = body.length;
  if (len === 0) return 0;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

/** Small inline help tooltip (keyboard-focusable). */
function Help({ text }: { text: string }) {
  return (
    <span className="ja-help" tabIndex={0} role="note" aria-label={text} title={text}>
      <HelpCircle size={12} aria-hidden="true" />
    </span>
  );
}

export default function NodeInspector({ node, templates, triggerSources, canEdit, onChange, onDelete }: Props) {
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

  // Notes are documentation-only annotations (not executed, not validated).
  if (node.type === "note") {
    return (
      <div className="ja-panel ja-panel-right p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-heading text-sm font-bold">Note</h3>
          <button type="button" className="ja-btn-sm" data-variant="danger" onClick={onDelete} disabled={disabled}>
            <Trash2 size={13} aria-hidden="true" /> Delete
          </button>
        </div>
        <div className="ja-field">
          <label className="ja-insp-label">Note text <Help text="A sticky note for your team. It is never sent or executed and is excluded from validation." /></label>
          <textarea className="ja-textarea" rows={6} value={String(cfg.text ?? "")} disabled={disabled} onChange={(e) => set({ text: e.target.value })} placeholder="Document this part of the journey…" />
        </div>
        <p className="text-xs text-muted">Notes help staff understand a journey. They carry no logic and are ignored by the engine.</p>
      </div>
    );
  }

  return (
    <div className="ja-panel ja-panel-right p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-heading text-sm font-bold capitalize">{String(node.type).replace(/_/g, " ")}</h3>
        <button type="button" className="ja-btn-sm" data-variant="danger" onClick={onDelete} disabled={disabled}>
          <Trash2 size={13} aria-hidden="true" /> Delete
        </button>
      </div>

      <div className="ja-field">
        <label className="ja-insp-label">Step name <Help text="A short label shown on the canvas so the flow reads clearly." /></label>
        <input className="ja-input" value={String(cfg.title ?? "")} disabled={disabled} onChange={(e) => set({ title: e.target.value })} />
      </div>

      <div className="ja-field">
        <label className="ja-insp-label">Description <Help text="Optional note shown on the node so staff understand this step at a glance. Not sent or executed." /></label>
        <textarea className="ja-textarea" rows={2} value={String(cfg.description ?? "")} disabled={disabled} onChange={(e) => set({ description: e.target.value })} placeholder="Optional: what this step is for…" />
      </div>

      {node.type === "trigger" && (
        <TriggerInspector cfg={cfg} disabled={disabled} set={set} triggerSources={triggerSources} />
      )}

      {node.type === "wait" && (
        <>
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
          <p className="text-xs text-muted">The journey pauses here, then continues. Business truth is re-checked before the next step (e.g. a paid student stops receiving reminders).</p>
        </>
      )}

      {node.type === "condition" && (
        <>
          <div className="ja-field">
            <label className="ja-insp-label">Check <Help text="Evaluated live against current business truth right before this step runs." /></label>
            <select className="ja-select" value={String(cfg.check ?? "has_logged_in")} disabled={disabled} onChange={(e) => set({ check: e.target.value })}>
              {CONDITION_CHECKS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-muted">{CONDITION_CHECKS.find((c) => c.value === (cfg.check ?? "has_logged_in"))?.help}</p>
          </div>
          <p className="text-xs text-muted">Connect the <b>Yes</b> edge (true) and the <b>No</b> edge (false) from this node to define both paths.</p>
        </>
      )}

      {node.type === "branch" && (
        <BranchInspector cfg={cfg} disabled={disabled} set={set} />
      )}

      {node.type === "staff_task" && (
        <>
          <div className="ja-field">
            <label className="ja-insp-label">Assign to <Help text="Team or person responsible. Creates a task record for humans — never sends anything." /></label>
            <input className="ja-input" placeholder="e.g. Counselling team" value={String(cfg.assignee ?? "")} disabled={disabled} onChange={(e) => set({ assignee: e.target.value })} />
          </div>
          <div className="ja-field">
            <label className="ja-insp-label">Task details</label>
            <textarea className="ja-textarea" placeholder="What should the team do?" value={String(cfg.details ?? "")} disabled={disabled} onChange={(e) => set({ details: e.target.value })} />
          </div>
          <p className="text-xs text-muted">Creates a follow-up task for the team (e.g. call a high-intent lead). No message is sent.</p>
        </>
      )}

      {node.type === "goal" && (
        <>
          <div className="ja-field">
            <label className="ja-insp-label">Goal achieved when <Help text="When this becomes true for a contact, the journey completes as a success and stops." /></label>
            <select className="ja-select" value={String(cfg.goalType ?? "logged_in")} disabled={disabled} onChange={(e) => set({ goalType: e.target.value })}>
              {GOAL_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted">Goals are checked before every step. A met goal exits the contact cleanly and powers conversion analytics.</p>
        </>
      )}

      {node.type === "exit" && (
        <p className="text-xs text-muted">Ends the journey for this contact with a clean exit. Use it to close every branch that isn&apos;t a goal.</p>
      )}

      {node.type === "send_sms" && (
        <SmsInspector cfg={cfg} templates={templates} selectedTemplate={selectedTemplate} disabled={disabled} set={set} />
      )}
    </div>
  );
}

function triggerLabel(eventType: string): string {
  const map: Record<string, string> = {
    lead_created: "A new lead is registered",
    payment_received: "A payment is received",
    installment_overdue: "An installment becomes overdue",
    webinar_registered: "A webinar registration happens",
  };
  return map[eventType] ?? eventType;
}

/**
 * Trigger config: the enrolling event + optional filters that narrow WHICH events
 * enrol (e.g. only leads from a specific form). Options are LIVE from the backend
 * (real forms/products/courses/webinars), so new sources appear automatically.
 * Empty selection = "All" (every event of this type enrols).
 */
function TriggerInspector({ cfg, disabled, set, triggerSources }: {
  cfg: Record<string, unknown>;
  disabled: boolean;
  set: (p: Record<string, unknown>) => void;
  triggerSources?: TriggerSources;
}) {
  const eventType = String(cfg.eventType ?? "");
  const dims = TRIGGER_FILTER_DIMS[eventType] ?? [];
  const filters = readTriggerFilters(cfg);

  function setDim(key: string, values: string[]) {
    const next = { ...filters } as Record<string, string[]>;
    if (values.length === 0) delete next[key];
    else next[key] = values;
    set({ filters: next });
  }
  function toggle(key: string, value: string) {
    const cur = filters[key] ?? [];
    setDim(key, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
  }

  return (
    <>
      <div className="ja-field">
        <label className="ja-insp-label">Enrolls when <Help text="The business event that starts this journey for a contact." /></label>
        <div className="ja-preview">{triggerLabel(eventType || "—")}</div>
      </div>

      {dims.map((dim) => {
        const options = triggerSources?.[eventType]?.[dim.key] ?? [];
        const selected = filters[dim.key] ?? [];
        const all = selected.length === 0;
        return (
          <div className="ja-field" key={dim.key}>
            <label className="ja-insp-label"><Filter size={11} aria-hidden="true" style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />{dim.label} <Help text={dim.help} /></label>
            <label className="ja-check">
              <input type="checkbox" checked={all} disabled={disabled} onChange={() => setDim(dim.key, [])} />
              <span>All ({dim.label.toLowerCase()}) — enrol every match</span>
            </label>
            {options.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted">No sources seen yet. New ones appear here automatically once they occur. Leave on “All” for now.</p>
            ) : (
              <div className="ja-check-list">
                {options.map((o) => (
                  <label className="ja-check" key={o.value}>
                    <input type="checkbox" checked={selected.includes(o.value)} disabled={disabled} onChange={() => toggle(dim.key, o.value)} />
                    <span>{o.label}{o.count > 0 ? <em className="text-muted"> · {o.count}</em> : <em className="text-muted"> · new</em>}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-muted">
        Every contact who triggers this event {dims.length ? "and matches the filter above " : ""}enrolls once. Nothing runs until execution is enabled — safe to design and dry-run now.
      </p>
    </>
  );
}

function BranchInspector({ cfg, disabled, set }: {
  cfg: Record<string, unknown>;
  disabled: boolean;
  set: (p: Record<string, unknown>) => void;
}) {
  const branches = normalizeBranches(cfg.branches);
  const total = branches.reduce((s, b) => s + (b.weight || 0), 0) || 1;

  function update(next: { label: string; weight: number }[]) {
    set({ branches: next });
  }

  return (
    <>
      <div className="ja-field">
        <label className="ja-insp-label">Paths &amp; weights <Help text="Contacts are split deterministically by weight. Connect one edge per label. Same contact always takes the same path." /></label>
        {branches.map((b, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-2">
            <input
              className="ja-input" placeholder="Path label" value={b.label} disabled={disabled}
              onChange={(e) => update(branches.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <input
              type="number" min={0} className="ja-input" style={{ maxWidth: 72 }} value={b.weight} disabled={disabled}
              onChange={(e) => update(branches.map((x, j) => (j === i ? { ...x, weight: Math.max(0, Number(e.target.value) || 0) } : x)))}
            />
            <span className="min-w-[38px] text-right text-[11px] text-muted">{Math.round((b.weight / total) * 100)}%</span>
            {branches.length > 2 && (
              <button type="button" className="ja-btn-sm" data-variant="danger" disabled={disabled} onClick={() => update(branches.filter((_, j) => j !== i))} aria-label="Remove path">
                <Trash2 size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {!disabled && branches.length < 5 && (
          <button type="button" className="ja-btn-sm mt-1" onClick={() => update([...branches, { label: String.fromCharCode(65 + branches.length), weight: 1 }])}>
            <Plus size={12} aria-hidden="true" /> Add path
          </button>
        )}
      </div>
      <p className="text-xs text-muted">Great for A/B testing message variants. Draw one edge from this node per path label.</p>
    </>
  );
}

function normalizeBranches(raw: unknown): { label: string; weight: number }[] {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((b) => (typeof b === "string" ? { label: b, weight: 1 } : { label: String((b as Record<string, unknown>)?.label ?? ""), weight: Math.max(0, Number((b as Record<string, unknown>)?.weight ?? 1) || 0) }));
  }
  return [{ label: "A", weight: 1 }, { label: "B", weight: 1 }];
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
  const category = String(cfg.category ?? "transactional");
  const body = selectedTemplate?.body ?? "";
  const missing = variables.filter((v) => !mapping[v] || String(mapping[v]).trim() === "");

  function selectTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    // Auto-map each DLT variable to the same-named journey variable when one exists.
    const known = new Set(JOURNEY_VARIABLES.map((j) => j.value));
    const autoMap: Record<string, string> = {};
    for (const v of t?.variables ?? []) if (known.has(v)) autoMap[v] = v;
    set({
      automationTemplateId: id || null,
      sms_template_id: t?.sms_template_id ?? null,
      templateName: t?.name ?? null,
      templateVariables: t?.variables ?? [],
      body: t?.body ?? "",
      variableMapping: { ...autoMap, ...mapping },
    });
  }

  // Empty state: no approved DLT templates exist in Mission Control.
  if (templates.length === 0) {
    return (
      <div className="ja-field">
        <label className="ja-insp-label">Approved DLT template</label>
        <div className="rounded-lg border p-3 text-xs" style={{ borderColor: "var(--gold)", background: "var(--gold-soft)" }}>
          <p className="font-semibold" style={{ color: "var(--navy, #0a1f44)" }}>No approved templates yet</p>
          <p className="mt-1 text-ink2">Journeys can only send DLT-approved templates. Create and approve one in SMS Mission Control, then it will appear here automatically.</p>
          <Link href="/admin/communications/sms" className="mt-2 inline-flex items-center gap-1 font-medium text-[var(--primary)] hover:underline">
            Open SMS Mission Control <ExternalLink size={12} aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }

  const pendingKey = typeof cfg.pendingTemplateKey === "string" && cfg.pendingTemplateKey ? cfg.pendingTemplateKey : null;

  return (
    <>
      {pendingKey && !cfg.automationTemplateId && (
        <div className="ja-field">
          <div className="rounded-lg border p-3 text-xs" style={{ borderColor: "var(--gold)", background: "var(--gold-soft)" }}>
            <p className="flex items-center gap-1 font-semibold" style={{ color: "var(--navy, #0a1f44)" }}>
              <AlertTriangle size={12} aria-hidden="true" /> Pending DLT approval
            </p>
            <p className="mt-1 text-ink2">
              This step needs the template <code className="text-[11px]">{pendingKey}</code>, which is drafted but not yet
              DLT-approved. Submit it (see <code className="text-[11px]">docs/reports/dlt-templates-to-approve.md</code>),
              approve it in SMS Mission Control, then select it below. The journey stays a safe draft until then.
            </p>
          </div>
        </div>
      )}
      <div className="ja-field">
        <label className="ja-insp-label">Approved DLT template <Help text="Only DLT-approved templates from SMS Mission Control can be selected. This is the single source of truth." /></label>
        <select className="ja-select" value={String(cfg.automationTemplateId ?? "")} disabled={disabled} onChange={(e) => selectTemplate(e.target.value)}>
          <option value="">Select a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {selectedTemplate && (
          <p className="mt-1 text-[11px] text-muted">DLT ID: {selectedTemplate.dlt_template_id ?? "—"} · Approved</p>
        )}
      </div>

      <div className="ja-field">
        <label className="ja-insp-label">Message category <Help text="Controls compliance suppression: payment reminders auto-stop once paid; promotional respects the promo flag." /></label>
        <select className="ja-select" value={category} disabled={disabled} onChange={(e) => set({ category: e.target.value })}>
          {SMS_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <p className="mt-1 text-[11px] text-muted">{SMS_CATEGORIES.find((c) => c.value === category)?.help}</p>
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
              <label className="ja-insp-label">Variable mapping <Help text="Map each template placeholder to a journey variable. Secret values (login code/URL) are resolved live at send time and never stored." /></label>
              {variables.map((v) => (
                <div key={v} className="mb-1.5 flex items-center gap-2">
                  <code className="min-w-[92px] text-[11px] text-ink2">{`{${v}}`}</code>
                  <select
                    className="ja-select"
                    value={mapping[v] ?? ""}
                    disabled={disabled}
                    onChange={(e) => set({ variableMapping: { ...mapping, [v]: e.target.value } })}
                  >
                    <option value="">— choose source —</option>
                    {JOURNEY_VARIABLES.map((j) => (
                      <option key={j.value} value={j.value}>{j.label}</option>
                    ))}
                  </select>
                </div>
              ))}
              {missing.length > 0 && (
                <p className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: "var(--danger)" }}>
                  <AlertTriangle size={12} aria-hidden="true" /> Map every variable: {missing.map((m) => `{${m}}`).join(", ")}
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
          <label className="ja-insp-label">Max sends <Help text="Frequency cap: the most sends allowed to a contact within the window below." /></label>
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
        <p className="mt-1 text-center text-[11px] text-muted">Sending is off. Use Validate + Dry-run to preview safely.</p>
      </div>
    </>
  );
}
