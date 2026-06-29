"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { istInputToISO } from "@/lib/dates";

interface Candidate {
  registration_id: string;
  name: string;
  phone: string;
  login_code: string | null;
  payment_status: string;
  amount: number | null;
  included: boolean;
  excluded_reason?: string | null;
}
interface Preview {
  totalFound: number;
  includedCount: number;
  excludedCount: number;
  perStatus: Record<string, number>;
  candidates: Candidate[];
}

const STATUS_OPTIONS = [
  { key: "PAID", label: "Paid" },
  { key: "PENDING", label: "Pending / Verifying" },
];

/**
 * FEATURE 3 — Move Late Registrations. ALWAYS dry-runs first; the confirm button
 * only appears after a preview. No registrant is deleted, no revenue duplicated.
 */
export default function MoveRegistrationsModal({
  source,
  onClose,
  onDone,
}: {
  source: { id: string; title: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [targets, setTargets] = useState<{ id: string; title: string }[]>([]);
  const [targetId, setTargetId] = useState("");
  const [cutoff, setCutoff] = useState("");
  const [statuses, setStatuses] = useState<string[]>(["PAID", "PENDING"]);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/webinars");
        const data = await res.json();
        if (data.ok) {
          setTargets(
            (data.webinars as { id: string; title: string }[])
              .filter((w) => w.id !== source.id)
              .map((w) => ({ id: w.id, title: w.title })),
          );
        }
      } catch {
        /* ignore */
      }
    })();
  }, [source.id]);

  function toggleStatus(key: string) {
    setStatuses((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
    setPreview(null); // re-preview required after changing filters
  }

  async function run(apply: boolean) {
    setError(null);
    if (!targetId) {
      setError("Choose a target webinar.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/webinars/move-registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: source.id,
          targetId,
          cutoffISO: cutoff ? istInputToISO(cutoff) : null,
          includeStatuses: statuses,
          reason: reason.trim() || null,
          apply,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Failed.");
        setBusy(false);
        return;
      }
      if (apply) {
        toast(`Moved ${data.movedCount} registration(s) to “${data.target?.title}”`, "success");
        onDone();
        return;
      }
      setPreview(data.preview as Preview);
    } catch {
      setError("Something went wrong.");
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Move late registrations</h2>
        <p className="mt-1 text-sm text-muted">
          From <b>{source.title}</b>. Always preview first — nothing changes until you confirm. Paid students keep their
          payment, login code, proof &amp; access; no one is re-charged.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-ink2">Target webinar *</span>
            <select className="input mt-1" value={targetId} onChange={(e) => { setTargetId(e.target.value); setPreview(null); }}>
              <option value="">Select…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink2">Only registrations after (IST, optional)</span>
            <input type="datetime-local" className="input mt-1" value={cutoff} onChange={(e) => { setCutoff(e.target.value); setPreview(null); }} />
          </label>
        </div>

        <div className="mt-3">
          <span className="text-xs font-semibold text-ink2">Include statuses</span>
          <div className="mt-1 flex flex-wrap gap-3">
            {STATUS_OPTIONS.map((o) => (
              <label key={o.key} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={statuses.includes(o.key)} onChange={() => toggleStatus(o.key)} />
                {o.label}
              </label>
            ))}
            <span className="text-xs text-muted">Free registrants are always included. Failed / abandoned are excluded.</span>
          </div>
        </div>

        <label className="mt-3 block">
          <span className="text-xs font-semibold text-ink2">Reason (audit log, optional)</span>
          <input className="input mt-1" placeholder="e.g. session rescheduled to next batch" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        {preview && (
          <div className="mt-4 rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <span><b>{preview.totalFound}</b> found</span>
              <span className="text-success"><b>{preview.includedCount}</b> will move</span>
              <span className="text-muted"><b>{preview.excludedCount}</b> excluded</span>
              {Object.entries(preview.perStatus).map(([k, v]) => (
                <span key={k} className="text-muted">{k}: {v}</span>
              ))}
            </div>
            <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface2 text-muted">
                  <tr>
                    <th className="px-2 py-1.5">Name</th>
                    <th className="px-2 py-1.5">Mobile</th>
                    <th className="px-2 py-1.5">Code</th>
                    <th className="px-2 py-1.5">Status</th>
                    <th className="px-2 py-1.5">Amount</th>
                    <th className="px-2 py-1.5">Move?</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.candidates.map((c) => (
                    <tr key={c.registration_id} className="border-t border-line">
                      <td className="px-2 py-1.5">{c.name}</td>
                      <td className="px-2 py-1.5 font-mono">{c.phone}</td>
                      <td className="px-2 py-1.5 font-mono">{c.login_code || "—"}</td>
                      <td className="px-2 py-1.5">{c.payment_status}</td>
                      <td className="px-2 py-1.5">{c.amount != null ? `₹${c.amount}` : "—"}</td>
                      <td className="px-2 py-1.5">{c.included ? <span className="text-success">Yes</span> : <span className="text-muted" title={c.excluded_reason || ""}>No</span>}</td>
                    </tr>
                  ))}
                  {preview.candidates.length === 0 && (
                    <tr><td colSpan={6} className="px-2 py-4 text-center text-muted">No matching registrations.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-secondary text-sm" disabled={busy}>Cancel</button>
          <button onClick={() => run(false)} className="btn btn-secondary text-sm" disabled={busy}>
            {busy && !preview ? "Previewing…" : "Preview (dry run)"}
          </button>
          {preview && preview.includedCount > 0 && (
            <button onClick={() => run(true)} className="btn btn-primary text-sm" disabled={busy}>
              {busy ? "Moving…" : `Confirm move (${preview.includedCount})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
