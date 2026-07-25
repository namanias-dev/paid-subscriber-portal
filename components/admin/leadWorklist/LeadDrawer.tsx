"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Ban, Loader2, MessageSquare, Phone, Undo2, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatISTDate, formatISTDateTime } from "@/lib/dates";
import { LEAD_WORK_STATUSES, type LeadWorklistRow } from "@/lib/types";
import type { LeadAuditEntry } from "@/lib/legacy-crm/writes";
import { ConsentBadge, Dash, LegacyChip, MaskedPhone, StatusPill } from "./cells";

/**
 * The lead detail drawer.
 *
 * Opens beside the table rather than navigating away, so a counsellor never
 * loses the several-thousand-row list they scrolled to build.
 *
 * THREE THINGS THIS SCREEN REFUSES TO DO
 * --------------------------------------
 * 1. It never edits `status` or `legacy_call_status_raw`. Both are shown, side
 *    by side, explicitly labelled as history. The API would answer 422 anyway;
 *    the UI does not offer the control in the first place.
 * 2. It never sends anything to a legacy lead. Outbound affordances are
 *    rendered — DISABLED, with the reason attached — rather than hidden, so
 *    the constraint is visible instead of mysterious.
 * 3. It never fabricates a value. Every empty field says so.
 */

interface DetailLead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  source: string | null;
  campaign: string | null;
  campaign_clean: string | null;
  channel: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  first_seen_at: string | null;
  import_source: string | null;
  import_batch: string | null;
  external_lead_id: string | null;
  legacy_source_tab: string | null;
  legacy_call_status: string | null;
  legacy_call_status_raw: string | null;
  is_legacy: boolean | null;
  cohort: string | null;
  promoted_at: string | null;
  promoted_by: string | null;
  assigned_to: string | null;
  counsellor: string | null;
  worklist_queue: string | null;
  work_status: string | null;
  work_status_at: string | null;
  work_status_by: string | null;
  follow_up_at: string | null;
  last_worked_at: string | null;
  last_contacted_at: string | null;
  contact_attempt_count: number | null;
  consent_status: string | null;
  consent_source: string | null;
  consent_captured_at: string | null;
  dnd_status: string | null;
  suppression_reason: string | null;
  opted_out_at: string | null;
  merged_into: string | null;
  merged_count: number | null;
}

interface LeadNote {
  id: string;
  lead_id: string;
  author: string | null;
  body: string;
  created_at: string;
}

interface LeadActivityRow {
  id: string;
  type: string | null;
  note: string | null;
  counsellor: string | null;
  timestamp: string | null;
}

interface DetailResponse {
  ok: boolean;
  error?: string;
  lead?: DetailLead;
  legacyTouches?: unknown[];
  legacyTouchCount?: number;
  notes?: LeadNote[];
  audit?: LeadAuditEntry[];
  activities?: LeadActivityRow[];
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function LeadDrawer({
  lead,
  currentAdmin,
  onClose,
  onRowPatch,
}: {
  /** The row that was clicked — renders instantly while the detail loads. */
  lead: LeadWorklistRow;
  currentAdmin: string | null;
  onClose: () => void;
  onRowPatch: (id: string, patch: Partial<LeadWorklistRow>) => void;
}) {
  const { toast } = useToast();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const [assignee, setAssignee] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [noteDraft, setNoteDraft] = useState("");

  const leadId = lead.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/worklist-detail`);
      const data = (await res.json().catch(() => null)) as DetailResponse | null;
      if (!res.ok || !data?.ok || !data.lead) {
        setError(data?.error || `Could not load this lead (HTTP ${res.status}).`);
        return;
      }
      setDetail(data);
      setAssignee(data.lead.assigned_to ?? "");
      setFollowUp(data.lead.follow_up_at ? data.lead.follow_up_at.slice(0, 10) : "");
      // Keep the row behind the drawer honest without refetching the list.
      onRowPatch(leadId, {
        assigned_to: data.lead.assigned_to,
        follow_up_at: data.lead.follow_up_at,
        work_status: data.lead.work_status as LeadWorklistRow["work_status"],
        work_status_at: data.lead.work_status_at,
        work_status_by: data.lead.work_status_by,
        consent_status: data.lead.consent_status as LeadWorklistRow["consent_status"],
        last_contacted_at: data.lead.last_contacted_at,
        contact_attempt_count: data.lead.contact_attempt_count,
        suppression_reason: data.lead.suppression_reason,
        last_worked_at: data.lead.last_worked_at,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this lead.");
    } finally {
      setLoading(false);
    }
  }, [leadId, onRowPatch]);

  useEffect(() => {
    void load();
  }, [load]);

  // Focus trap + ESC. Capture phase so the drawer wins over anything below it.
  useEffect(() => {
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("[data-drawer-autofocus]")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function act(payload: Record<string, unknown>, successMessage: string) {
    const action = String(payload.action);
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/worklist-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; changed?: boolean }
        | null;
      if (!res.ok || !data?.ok) {
        toast(data?.error || `That action failed (HTTP ${res.status}).`, "error");
        return false;
      }
      toast(data.changed === false ? "Already set — nothing changed." : successMessage, data.changed === false ? "info" : "success");
      await load();
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "That action failed.", "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const l = detail?.lead;
  const isLegacy = l ? !!l.is_legacy : lead.is_legacy;
  const block = outreachBlockReason({
    isLegacy,
    consent: l?.consent_status ?? lead.consent_status,
    dnd: l?.dnd_status ?? lead.dnd_status,
    suppression: l?.suppression_reason ?? lead.suppression_reason,
  });

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-full max-w-[560px] animate-fade-in flex-col border-l border-line bg-white shadow-soft-lg"
      >
        {/* ---- header ---- */}
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id={titleId} className="truncate font-heading text-lg font-extrabold">
                {(l?.name ?? lead.name)?.trim() || "Unnamed lead"}
              </h2>
              {isLegacy && <LegacyChip />}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {isLegacy
                ? "Re-engagement (legacy) — imported from the team's sheet"
                : "Live captured by the public site"}
            </p>
          </div>
          <button
            type="button"
            data-drawer-autofocus
            onClick={onClose}
            aria-label="Close lead details"
            className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-surface hover:text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        {/* ---- body ---- */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && !detail && <DrawerSkeleton />}

          {error && (
            <div className="rounded-xl border border-[#f5c2c2] bg-[#fdeaea] p-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
                <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" />
                This lead could not be loaded
              </p>
              <p className="mt-1 text-sm text-ink2">{error}</p>
              <button type="button" onClick={() => void load()} className="btn btn-secondary mt-3 py-1.5 text-sm">
                Retry
              </button>
            </div>
          )}

          {l && (
            <div className="space-y-5">
              {/* ---------------- identity ---------------- */}
              <Section title="Identity">
                <Grid>
                  <Field label="Phone">
                    <MaskedPhone
                      phone={l.phone}
                      revealed={revealed}
                      size="md"
                      onToggle={() => setRevealed((v) => !v)}
                    />
                  </Field>
                  <Field label="Email">{l.email || <Dash />}</Field>
                  <Field label="City">{l.city || <Dash />}</Field>
                  <Field label="State">{l.state || <Dash />}</Field>
                </Grid>
              </Section>

              {/* ---------------- history, not editable ---------------- */}
              <Section
                title="Status history"
                hint="Both values are frozen provenance. Neither can be edited from this screen — the write layer refuses them."
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-line bg-surface p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Pipeline status
                    </p>
                    <div className="mt-1.5">
                      <StatusPill status={l.status} />
                    </div>
                    <p className="mt-2 text-[11px] leading-tight text-muted">
                      The Phase 0c mapping. Read-only.
                    </p>
                  </div>
                  <div className="rounded-xl border border-line bg-surface p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Call status from the sheet
                    </p>
                    {/* VERBATIM. The team's own wording, never re-mapped. */}
                    <p className="mt-1.5 break-words text-sm font-medium text-ink">
                      {l.legacy_call_status_raw ?? <Dash />}
                    </p>
                    <p className="mt-2 text-[11px] leading-tight text-muted">
                      Exactly as written in the source sheet. Read-only.
                    </p>
                  </div>
                </div>
              </Section>

              {/* ---------------- outreach ---------------- */}
              <Section title="Outreach">
                <div className="flex flex-wrap gap-2">
                  <OutreachAction
                    label="WhatsApp"
                    icon={<MessageSquare size={14} strokeWidth={1.75} aria-hidden="true" />}
                    blockedReason={block}
                    href={l.phone ? waLink(l.phone, l.name) : undefined}
                  />
                  <OutreachAction
                    label="Call"
                    icon={<Phone size={14} strokeWidth={1.75} aria-hidden="true" />}
                    blockedReason={block}
                    href={l.phone ? `tel:${l.phone}` : undefined}
                  />
                  <OutreachAction
                    label="SMS"
                    icon={<MessageSquare size={14} strokeWidth={1.75} aria-hidden="true" />}
                    blockedReason={block}
                    href={undefined}
                    onClick={() =>
                      toast("Sending is not part of Phase 2. Use SMS Mission Control.", "info")
                    }
                  />
                </div>
                {block ? (
                  <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed text-ink2">
                    <Ban size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                    <span>{block}</span>
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted">
                    Consent is <span className="font-semibold">{l.consent_status ?? "not recorded"}</span>
                    {l.consent_source ? ` (${l.consent_source})` : ""}. Phase 2 itself sends nothing;
                    these open the existing channels.
                  </p>
                )}
              </Section>

              {/* ---------------- work actions ---------------- */}
              <Section title="Work this lead">
                <Grid>
                  <Field label="Work status">
                    <select
                      className="input py-1.5 text-sm"
                      value={l.work_status ?? ""}
                      disabled={busy === "work_status"}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v) void act({ action: "work_status", work_status: v }, `Work status set to ${v.replace(/_/g, " ")}.`);
                      }}
                      aria-label="Work status"
                    >
                      <option value="">Not worked yet</option>
                      {LEAD_WORK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-muted">
                      {l.work_status_at
                        ? `Set ${formatISTDateTime(l.work_status_at)}${l.work_status_by ? ` by ${l.work_status_by}` : ""}`
                        : "No counsellor has worked this lead yet."}
                    </p>
                  </Field>

                  <Field label="Follow-up date">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        className="input py-1.5 text-sm"
                        value={followUp}
                        onChange={(e) => setFollowUp(e.target.value)}
                        aria-label="Follow-up date"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
                        disabled={busy === "follow_up"}
                        onClick={() =>
                          void act(
                            {
                              action: "follow_up",
                              follow_up_at: followUp ? new Date(`${followUp}T09:00:00+05:30`).toISOString() : null,
                            },
                            followUp ? "Follow-up saved." : "Follow-up cleared.",
                          )
                        }
                      >
                        Save
                      </button>
                    </div>
                  </Field>
                </Grid>

                <Field label="Assigned counsellor">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      className="input min-w-[160px] flex-1 py-1.5 text-sm"
                      value={assignee}
                      placeholder="Unassigned"
                      onChange={(e) => setAssignee(e.target.value)}
                      aria-label="Assigned counsellor"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
                      disabled={busy === "assign"}
                      onClick={() =>
                        void act(
                          { action: "assign", assignee: assignee.trim() || null },
                          assignee.trim() ? `Assigned to ${assignee.trim()}.` : "Unassigned.",
                        )
                      }
                    >
                      Save
                    </button>
                    {currentAdmin && (
                      <button
                        type="button"
                        className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
                        disabled={busy === "assign"}
                        onClick={() => {
                          setAssignee(currentAdmin);
                          void act({ action: "assign", assignee: currentAdmin }, `Assigned to ${currentAdmin}.`);
                        }}
                      >
                        Assign to me
                      </button>
                    )}
                  </div>
                </Field>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <ActionButton
                    label="Log contact attempt"
                    busy={busy === "contact_attempt"}
                    onClick={() => void act({ action: "contact_attempt" }, "Contact attempt recorded.")}
                  />
                  <ActionButton
                    label="Wrong number"
                    busy={busy === "wrong_number"}
                    onClick={() => void act({ action: "wrong_number" }, "Marked wrong number.")}
                    title="Records the fact on the lead. The phone number itself is never edited or erased."
                  />
                  <ActionButton
                    label="Unreachable"
                    busy={busy === "unreachable"}
                    onClick={() => void act({ action: "unreachable" }, "Marked unreachable.")}
                  />
                  <ActionButton
                    label="Opted out"
                    danger
                    busy={busy === "opt_out"}
                    onClick={() => void act({ action: "opt_out" }, "Marked opted out. This lead is now suppressed.")}
                    title="Sets consent to opted out and suppresses the lead from every future send."
                  />
                </div>
              </Section>

              {/* ---------------- provenance ---------------- */}
              <Section title="Provenance">
                <Grid>
                  <Field label="Source">{l.source || <Dash />}</Field>
                  <Field label="Channel">{l.channel || <Dash />}</Field>
                  <Field label="Campaign">{l.campaign || <Dash />}</Field>
                  <Field label="Campaign (clean)">
                    {/* `campaign_clean` is written only by the legacy import and is
                        NULL for 100% of live-captured leads, so the "no campaign"
                        phrasing is gated on provenance rather than on the null. */}
                    {l.campaign_clean ? (
                      l.campaign_clean
                    ) : l.is_legacy ? (
                      <span className="italic text-muted">Legacy — no campaign</span>
                    ) : (
                      <Dash />
                    )}
                  </Field>
                  <Field label="Legacy source tab">{l.legacy_source_tab || <Dash />}</Field>
                  <Field label="Import source">{l.import_source || <Dash />}</Field>
                  <Field label="Import batch">
                    {l.import_batch ? <Mono>{l.import_batch}</Mono> : <Dash />}
                  </Field>
                  <Field label="External lead id">
                    {l.external_lead_id ? <Mono>{l.external_lead_id}</Mono> : <Dash />}
                  </Field>
                  <Field label="First seen">{l.first_seen_at ? formatISTDateTime(l.first_seen_at) : <Dash />}</Field>
                  <Field label="Created">{l.created_at ? formatISTDateTime(l.created_at) : <Dash />}</Field>
                  <Field label="Cohort">{l.cohort || <Dash />}</Field>
                  <Field label="Is legacy">{l.is_legacy ? "Yes" : "No"}</Field>
                  {l.promoted_at && (
                    <Field label="Promoted">
                      {formatISTDateTime(l.promoted_at)}
                      {l.promoted_by ? ` by ${l.promoted_by}` : ""}
                    </Field>
                  )}
                  <Field label="Consent">
                    <ConsentBadge value={l.consent_status} />
                  </Field>
                </Grid>

                <LegacyTouches
                  touches={detail?.legacyTouches ?? []}
                  count={detail?.legacyTouchCount ?? 0}
                />
              </Section>

              {/* ---------------- contact history ---------------- */}
              <Section title="Contact history">
                <Grid>
                  <Field label="Last contacted">
                    {l.last_contacted_at ? (
                      formatISTDateTime(l.last_contacted_at)
                    ) : (
                      <span className="text-muted">Never</span>
                    )}
                  </Field>
                  <Field label="Contact attempts">
                    <span className="tabular-nums">{l.contact_attempt_count ?? 0}</span>
                  </Field>
                </Grid>
                {(detail?.activities?.length ?? 0) === 0 ? (
                  <p className="mt-2 text-xs text-muted">No recorded activity.</p>
                ) : (
                  <ol className="mt-2 space-y-1.5">
                    {(detail?.activities ?? []).map((a) => (
                      <li
                        key={a.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs"
                      >
                        <span className="min-w-0">
                          <span className="font-semibold text-ink">{a.type || "activity"}</span>
                          {a.note && <span className="text-ink2"> · {a.note}</span>}
                          {a.counsellor && <span className="text-muted"> · {a.counsellor}</span>}
                        </span>
                        <span className="shrink-0 text-muted">{formatISTDate(a.timestamp)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              {/* ---------------- notes ---------------- */}
              <Section title="Notes" hint="Append-only. A counsellor's record of what a lead said is evidence.">
                <div className="flex gap-2">
                  <textarea
                    className="input min-h-[44px] py-2 text-sm"
                    rows={2}
                    value={noteDraft}
                    placeholder="Add a note…"
                    onChange={(e) => setNoteDraft(e.target.value)}
                    aria-label="Add a note"
                  />
                  <button
                    type="button"
                    className="btn btn-primary shrink-0 self-start px-3 py-2 text-xs"
                    disabled={!noteDraft.trim() || busy === "note"}
                    onClick={async () => {
                      const ok = await act({ action: "note", body: noteDraft.trim() }, "Note added.");
                      if (ok) setNoteDraft("");
                    }}
                  >
                    Add
                  </button>
                </div>
                {(detail?.notes?.length ?? 0) === 0 ? (
                  <p className="mt-2 text-xs text-muted">No notes yet.</p>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {(detail?.notes ?? []).map((n) => (
                      <li key={n.id} className="rounded-xl border border-line bg-surface p-3">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                          <span className="font-semibold text-ink2">{n.author || "Unknown author"}</span>
                          <span>{formatISTDateTime(n.created_at)}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{n.body}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              {/* ---------------- audit ---------------- */}
              <Section
                title="Change history"
                hint="Append-only. A reverted change stays visible alongside its reversal — seeing both is strictly more informative than seeing neither."
              >
                {(detail?.audit?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted">Nothing has been changed on this lead yet.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {(detail?.audit ?? []).map((entry) => (
                      <AuditRow
                        key={entry.id}
                        entry={entry}
                        busy={busy === "revert"}
                        onRevert={() =>
                          void act({ action: "revert", audit_id: entry.id }, "Change reverted.")
                        }
                      />
                    ))}
                  </ol>
                )}
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Outreach gating
// =====================================================================

/**
 * Why this lead cannot be messaged, or null when it can.
 *
 * Legacy is the categorical case and the reason is stated in full: consent is
 * `unknown` on all 178,183 imported rows, so there is no record that any of
 * those people agreed to be contacted. Withdrawal, opt-out, DND and an active
 * suppression are the per-lead cases.
 *
 * A LIVE lead whose consent is merely unrecorded is NOT blocked here — that is
 * the state the existing Lead CRM already sends from, and silently changing
 * that rule from a new screen would be a policy change wearing a UI costume.
 */
function outreachBlockReason(input: {
  isLegacy: boolean;
  consent: string | null;
  dnd: string | null;
  suppression: string | null;
}): string | null {
  if (input.consent === "withdrawn" || input.consent === "opted_out") {
    return "This person has opted out. Outbound SMS, WhatsApp and calls are permanently suppressed for this lead.";
  }
  if (input.isLegacy) {
    return (
      "This is a re-engagement (legacy) lead. consent_status is `unknown` for all 178,183 " +
      "leads imported from the sheet — a phone number appearing in an old spreadsheet is not " +
      "evidence that the person agreed to be contacted, so we hold none. Outbound SMS, " +
      "WhatsApp and calls stay disabled until consent is explicitly captured and recorded."
    );
  }
  if (input.dnd && input.dnd.toLowerCase() !== "clear" && input.dnd.toLowerCase() !== "none") {
    return `This number is flagged DND (${input.dnd}). Outbound messaging is disabled.`;
  }
  if (input.suppression) {
    return `This lead is suppressed (${input.suppression}). Outbound messaging is disabled.`;
  }
  return null;
}

/**
 * A send affordance. When blocked it is still RENDERED — visibly present,
 * inert, and carrying its reason — because a hidden control teaches nobody
 * anything, while a disabled one with an explanation teaches the policy.
 *
 * `aria-disabled` rather than `disabled`: the control stays focusable, so a
 * keyboard user can reach it and hear why it cannot be used.
 */
function OutreachAction({
  label,
  icon,
  blockedReason,
  href,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  blockedReason: string | null;
  href?: string;
  onClick?: () => void;
}) {
  const tipId = useId();

  if (!blockedReason) {
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-secondary gap-1.5 px-4 py-2 text-sm"
      >
        {icon}
        {label}
      </a>
    ) : (
      <button type="button" onClick={onClick} className="btn btn-secondary gap-1.5 px-4 py-2 text-sm">
        {icon}
        {label}
      </button>
    );
  }

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={tipId}
        title={blockedReason}
        onClick={(e) => e.preventDefault()}
        className="btn btn-secondary cursor-not-allowed gap-1.5 px-4 py-2 text-sm opacity-50"
      >
        {icon}
        {label}
      </button>
      <span
        role="tooltip"
        id={tipId}
        className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl border border-line bg-white p-3 text-left text-[11px] leading-relaxed text-ink2 opacity-0 shadow-soft-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {blockedReason}
      </span>
    </span>
  );
}

// =====================================================================
// Small pieces
// =====================================================================

function AuditRow({
  entry,
  busy,
  onRevert,
}: {
  entry: LeadAuditEntry;
  busy: boolean;
  onRevert: () => void;
}) {
  const reverted = !!entry.reverted_at;
  // Notes are append-only evidence, so they carry no revert affordance. The
  // API enforces the same rule and would answer 500 if asked.
  const reversible = !!entry.field && entry.action !== "note" && !reverted;
  return (
    <li
      className={`rounded-xl border px-3 py-2 text-xs ${
        reverted ? "border-line bg-surface2" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`min-w-0 ${reverted ? "line-through opacity-60" : ""}`}>
          <p className="font-semibold text-ink">
            {entry.action.replace(/_/g, " ")}
            {entry.field ? <span className="font-normal text-muted"> · {entry.field}</span> : null}
          </p>
          <p className="mt-0.5 break-words text-ink2">
            <span className="text-muted">{entry.before_value ?? "—"}</span>
            <span className="mx-1.5 text-muted" aria-hidden="true">
              →
            </span>
            <span className="font-medium">{entry.after_value ?? "—"}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {entry.actor} · {formatISTDateTime(entry.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {reverted && (
            <span className="pill pill-gray px-2 py-0 text-[10px]" title={`Reverted ${formatISTDateTime(entry.reverted_at)}${entry.reverted_by ? ` by ${entry.reverted_by}` : ""}`}>
              Reverted
            </span>
          )}
          {entry.reverses_id && (
            <span className="pill pill-blue px-2 py-0 text-[10px]" title="This entry is itself the undo of an earlier change.">
              Undo
            </span>
          )}
          {reversible && (
            <button
              type="button"
              onClick={onRevert}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink2 transition hover:border-line-strong hover:text-ink disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Undo2 size={11} strokeWidth={2} aria-hidden="true" />
              Revert
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** A touch field worth surfacing, and the label the drawer gives it. */
const TOUCH_FIELDS: { key: string; label: string; verbatim?: boolean }[] = [
  { key: "form_name", label: "Form" },
  { key: "campaign_clean", label: "Campaign" },
  { key: "campaign_raw", label: "Campaign (raw)" },
  // Same rule as the table column: the team's own wording, never re-mapped.
  { key: "calling_status_raw", label: "Call status", verbatim: true },
  { key: "source_type", label: "Source type" },
  { key: "platform_hint", label: "Platform" },
  { key: "winner", label: "Resolver" },
  { key: "source_row", label: "Sheet row" },
];

/**
 * Legacy touch history, from the side table the JSONB slimming moved it into.
 *
 * The stored shape is the importer's, not a declared contract, so nothing is
 * assumed: the known keys are read by name and ANY remaining scalar key is
 * still listed rather than silently dropped. These rows describe where a lead
 * came from, and quietly discarding a field because this component did not
 * expect it would lose provenance that exists nowhere else.
 *
 * There is no timestamp on a touch — the sheet never carried one — so none is
 * displayed. `tab` plus `source_row` is the real coordinate.
 */
function LegacyTouches({ touches, count }: { touches: unknown[]; count: number }) {
  if (count === 0 && touches.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Legacy touch history
        </p>
        <span className="pill pill-gray px-2 py-0 text-[10px]">
          {count} {count === 1 ? "touch" : "touches"}
        </span>
      </div>
      <ol className="max-h-56 space-y-2 overflow-y-auto">
        {touches.map((touch, i) => {
          if (!touch || typeof touch !== "object") {
            return (
              <li key={i} className="break-all text-[11px] text-ink2">
                {String(touch)}
              </li>
            );
          }
          const o = touch as Record<string, unknown>;
          const known = new Set([...TOUCH_FIELDS.map((f) => f.key), "tab"]);
          const extras = Object.entries(o).filter(
            ([k, v]) => !known.has(k) && v !== null && v !== "" && typeof v !== "object",
          );
          return (
            <li key={i} className="rounded-lg border border-line bg-white px-2.5 py-2">
              <p className="text-[11px] font-semibold text-ink">
                {typeof o.tab === "string" && o.tab ? o.tab : `Touch ${i + 1}`}
              </p>
              <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-[11px]">
                {TOUCH_FIELDS.map(({ key, label, verbatim }) => {
                  const v = o[key];
                  if (v === null || v === undefined || v === "") return null;
                  return (
                    <div key={key} className="contents">
                      <dt className="whitespace-nowrap text-muted">{label}</dt>
                      <dd className={`min-w-0 break-words ${verbatim ? "font-medium text-ink" : "text-ink2"}`}>
                        {String(v)}
                      </dd>
                    </div>
                  );
                })}
                {extras.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="whitespace-nowrap text-muted">{k}</dt>
                    <dd className="min-w-0 break-words text-ink2">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  danger,
  title,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
      style={{
        borderColor: danger ? "#f5c2c2" : "var(--line)",
        color: danger ? "var(--danger)" : "var(--ink2)",
        background: "#fff",
      }}
    >
      {busy && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
      {label}
    </button>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {hint && <p className="mb-2 mt-0.5 text-[11px] leading-tight text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-0.5 break-words text-sm text-ink">{children}</div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="break-all font-mono text-xs">{children}</span>;
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="skeleton h-3 w-24 animate-shimmer" />
          <div className="skeleton h-16 w-full animate-shimmer" />
        </div>
      ))}
    </div>
  );
}

/** WhatsApp deep link, mirroring the existing Lead CRM's helper. */
function waLink(phone: string, name: string | null): string {
  const cleaned = phone.replace(/\D/g, "");
  const withCountry = cleaned.length === 10 ? `91${cleaned}` : cleaned;
  const text = `Hi ${name || ""}, this is Naman IAS Academy team. `;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}
