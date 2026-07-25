"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Users, X, AlertTriangle, Undo2, CheckCircle2 } from "lucide-react";

/**
 * Bulk ASSIGNMENT. Ownership only — this dialog cannot change a status, edit a
 * field, or send anything.
 *
 * The flow is deliberately two-step and the preview is not decorative. The
 * server resolves the selection into an explicit manifest of lead ids and
 * returns the exact per-counsellor split; "Assign" then submits that manifest
 * back rather than re-describing the selection. So the numbers on screen are
 * the numbers that commit, even though the public site is inserting leads the
 * whole time the dialog is open.
 *
 * Above 1,000 rows the operator types a phrase containing the row count. A
 * fixed word like "CONFIRM" can be typed from muscle memory; a number has to
 * be read off the screen first. The server re-derives that phrase from what is
 * actually about to change, so an approval for 1,200 cannot commit 1,400.
 */

interface Counsellor {
  username: string;
  name: string | null;
  role: string | null;
  queueDepth: number;
}

interface AssigneeBreakdown {
  username: string;
  assigning: number;
  alreadyOwned: number;
  queueBefore: number;
  queueAfter: number;
}

interface Plan {
  batchId: string;
  totalMatched: number;
  totalChanging: number;
  totalAlreadyOwned: number;
  perAssignee: AssigneeBreakdown[];
  assignments: Record<string, string>;
  capped: boolean;
  requiresTypedConfirmation: boolean;
  confirmationPhrase: string | null;
  warnings: string[];
}

interface CommitResult {
  batchId: string;
  assigned: number;
  skippedAlreadyOwned: number;
  driftedSincePreview: { leadId: string }[];
  missing: string[];
}

type Mode = "single" | "round_robin";

export function BulkAssignModal({
  open,
  onClose,
  leadIds,
  scope,
  onCommitted,
}: {
  open: boolean;
  onClose: () => void;
  leadIds: string[];
  scope: string;
  onCommitted: () => void;
}) {
  const [counsellors, setCounsellors] = useState<Counsellor[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [mode, setMode] = useState<Mode>("single");
  const [single, setSingle] = useState("");
  const [rota, setRota] = useState<Set<string>>(new Set());

  const [plan, setPlan] = useState<Plan | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Any change to the inputs invalidates the plan. Leaving a stale preview on
  // screen next to changed inputs is how someone approves the wrong number.
  const invalidate = useCallback(() => { setPlan(null); setTyped(""); setResult(null); }, []);

  useEffect(() => {
    if (!open) return;
    setLoadingPeople(true);
    setError(null);
    fetch(`/api/admin/leads/assignees?scope=${encodeURIComponent(scope)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setCounsellors(j.counsellors ?? []);
        else setError(j?.error ?? "Could not load the counsellor list.");
      })
      .catch(() => setError("Could not load the counsellor list."))
      .finally(() => setLoadingPeople(false));
  }, [open, scope]);

  useEffect(() => {
    if (!open) {
      setPlan(null); setTyped(""); setResult(null); setError(null);
      setSingle(""); setRota(new Set()); setMode("single");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const f = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select,[tabindex]:not([tabindex="-1"])',
      );
      if (!f.length) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const distribution = useMemo(() => {
    if (mode === "single") return single ? { mode: "single" as const, assignee: single } : null;
    const names = [...rota];
    return names.length ? { mode: "round_robin" as const, assignees: names } : null;
  }, [mode, single, rota]);

  async function post(body: unknown) {
    const res = await fetch("/api/admin/leads/bulk-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  async function doPreview() {
    if (!distribution) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const { json } = await post({ mode: "preview", lead_ids: leadIds, distribution, scope });
      if (json?.ok) { setPlan(json.plan); setTyped(""); }
      else setError(json?.error ?? "Preview failed.");
    } catch {
      setError("Preview failed.");
    } finally { setBusy(false); }
  }

  async function doCommit() {
    if (!plan) return;
    setBusy(true); setError(null);
    try {
      const { json } = await post({
        mode: "commit", plan, typed_confirmation: typed || null,
      });
      if (json?.ok) { setResult(json.result); setPlan(null); onCommitted(); }
      else setError(json?.error ?? "Assignment failed.");
    } catch {
      setError("Assignment failed.");
    } finally { setBusy(false); }
  }

  async function doRevert(batchId: string) {
    setBusy(true); setError(null);
    try {
      const { json } = await post({ mode: "revert", batch_id: batchId });
      if (json?.ok) { setResult(null); onCommitted(); onClose(); }
      else setError(json?.error ?? "Revert failed.");
    } catch {
      setError("Revert failed.");
    } finally { setBusy(false); }
  }

  if (!open) return null;

  const confirmSatisfied =
    !plan?.requiresTypedConfirmation || typed.trim() === (plan?.confirmationPhrase ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-assign-title"
        className="w-full max-w-2xl rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="bulk-assign-title" className="flex items-center gap-2 text-base font-semibold text-ink">
              <Users size={16} strokeWidth={2} aria-hidden="true" />
              Assign {leadIds.length.toLocaleString("en-IN")} lead{leadIds.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-0.5 text-xs text-ink2">
              Changes ownership only. Status, notes and contact history are untouched, and nothing is sent.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink2 transition hover:bg-surface2 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* ---- distribution ---- */}
          <fieldset disabled={busy}>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink2">
              How should these be shared out?
            </legend>
            <div className="flex flex-wrap gap-2">
              {(["single", "round_robin"] as Mode[]).map((m) => (
                <label
                  key={m}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                    mode === m ? "border-[var(--primary)] bg-[var(--primary-tint)] font-semibold text-primary" : "border-line text-ink2 hover:bg-surface2"
                  }`}
                >
                  <input
                    type="radio"
                    name="bulk-assign-mode"
                    className="sr-only"
                    checked={mode === m}
                    onChange={() => { setMode(m); invalidate(); }}
                  />
                  {m === "single" ? "All to one counsellor" : "Round-robin across several"}
                </label>
              ))}
            </div>
          </fieldset>

          {loadingPeople ? (
            <p className="flex items-center gap-2 text-sm text-ink2">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading counsellors…
            </p>
          ) : counsellors.length === 0 ? (
            <p className="rounded-lg bg-surface2 px-3 py-2 text-sm text-ink2">
              No eligible counsellors. Someone must be an active admin with the
              lead-management permission before work can be assigned to them.
            </p>
          ) : mode === "single" ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink2">Counsellor</span>
              <select
                className="input w-full py-1.5 text-sm"
                value={single}
                disabled={busy}
                onChange={(e) => { setSingle(e.target.value); invalidate(); }}
              >
                <option value="">Choose someone…</option>
                {counsellors.map((c) => (
                  <option key={c.username} value={c.username}>
                    {c.name ? `${c.name} (${c.username})` : c.username} — {c.queueDepth.toLocaleString("en-IN")} in queue
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div>
              <span className="mb-1 block text-xs font-medium text-ink2">
                Share evenly between
              </span>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                {counsellors.map((c) => (
                  <label key={c.username} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface2">
                    <input
                      type="checkbox"
                      checked={rota.has(c.username)}
                      disabled={busy}
                      onChange={(e) => {
                        setRota((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(c.username); else next.delete(c.username);
                          return next;
                        });
                        invalidate();
                      }}
                    />
                    <span className="flex-1">{c.name ? `${c.name} (${c.username})` : c.username}</span>
                    <span className="text-xs text-ink2">{c.queueDepth.toLocaleString("en-IN")} in queue</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ---- preview ---- */}
          {plan && (
            <div className="rounded-xl border border-line bg-surface2 p-3">
              <p className="text-sm font-semibold text-ink">
                {plan.totalChanging.toLocaleString("en-IN")} lead{plan.totalChanging === 1 ? "" : "s"} will change hands
                {plan.totalAlreadyOwned > 0 && (
                  <span className="ml-1 font-normal text-ink2">
                    ({plan.totalAlreadyOwned.toLocaleString("en-IN")} already with that counsellor — left alone)
                  </span>
                )}
              </p>

              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink2">
                    <th scope="col" className="py-1 font-medium">Counsellor</th>
                    <th scope="col" className="py-1 text-right font-medium">Assigning</th>
                    <th scope="col" className="py-1 text-right font-medium">Queue after</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.perAssignee.map((a) => (
                    <tr key={a.username} className="border-t border-line">
                      <td className="py-1">{a.username}</td>
                      <td className="py-1 text-right tabular-nums">{a.assigning.toLocaleString("en-IN")}</td>
                      <td className="py-1 text-right tabular-nums text-ink2">
                        {a.queueBefore.toLocaleString("en-IN")} → <strong className="text-ink">{a.queueAfter.toLocaleString("en-IN")}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {plan.warnings.map((w) => (
                <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-ink2">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {w}
                </p>
              ))}

              {plan.requiresTypedConfirmation && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-medium text-ink">
                    This is a large change. Type <code className="rounded bg-white px-1 font-mono">{plan.confirmationPhrase}</code> to continue.
                  </span>
                  <input
                    className="input w-full py-1.5 font-mono text-sm"
                    value={typed}
                    disabled={busy}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={plan.confirmationPhrase ?? ""}
                    aria-label="Type the confirmation phrase"
                    autoComplete="off"
                  />
                </label>
              )}
            </div>
          )}

          {/* ---- result ---- */}
          {result && (
            <div className="rounded-xl border border-[var(--ok)] bg-[var(--ok-tint)] p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <CheckCircle2 size={14} aria-hidden="true" />
                {result.assigned.toLocaleString("en-IN")} lead{result.assigned === 1 ? "" : "s"} reassigned
              </p>
              {result.skippedAlreadyOwned > 0 && (
                <p className="mt-1 text-xs text-ink2">
                  {result.skippedAlreadyOwned.toLocaleString("en-IN")} already had that owner and were left alone.
                </p>
              )}
              {result.driftedSincePreview.length > 0 && (
                <p className="mt-1 text-xs text-ink2">
                  {result.driftedSincePreview.length.toLocaleString("en-IN")} had been reassigned by someone else
                  since the preview. They were moved as requested; reverting restores their previous owner.
                </p>
              )}
              {result.missing.length > 0 && (
                <p className="mt-1 text-xs text-ink2">
                  {result.missing.length.toLocaleString("en-IN")} no longer exist and were skipped.
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void doRevert(result.batchId)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface2 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              >
                <Undo2 size={12} aria-hidden="true" />
                Undo this batch
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-[var(--danger)] bg-[var(--danger-tint)] px-3 py-2 text-sm text-ink">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink2 transition hover:bg-surface2 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          >
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <>
              <button
                type="button"
                onClick={() => void doPreview()}
                disabled={busy || !distribution}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-surface2 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              >
                {busy && !plan ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                Preview
              </button>
              <button
                type="button"
                onClick={() => void doCommit()}
                disabled={busy || !plan || plan.totalChanging === 0 || !confirmSatisfied}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                title={!plan ? "Preview first" : !confirmSatisfied ? "Type the confirmation phrase to continue" : undefined}
              >
                {busy && plan ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                Assign
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
