"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Loader2, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatISTDateTime } from "@/lib/dates";

/**
 * Instructions messages that are queued but have not fired yet, with a way to
 * stop them.
 *
 * A send scheduled half an hour out that staff can neither see nor cancel is
 * worse than no scheduling at all — the first time anyone would learn about it
 * is a student replying to it. The list collapses to a single line when the queue
 * is empty so it costs nothing on a normal day.
 *
 * The auto-cancels (paid, opted out, plan changed) still happen without anyone
 * touching this; the button is for the case a human simply changes their mind.
 */

interface PendingFollowUp {
  id: string;
  maskedPhone: string;
  studentName: string | null;
  installmentNo: number;
  scheduledAt: string;
  status: string;
  attempts: number;
}

export default function PendingFollowUps({ refreshKey = 0 }: { refreshKey?: number }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<PendingFollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/sms/installment-reminder/follow-ups")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setRows(j.followUps as PendingFollowUp[]); })
      .catch(() => { /* the page works without this panel */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, refreshKey]);

  async function cancel(id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/sms/installment-reminder/follow-ups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        toast("Scheduled instructions cancelled — it will not be sent.", "success");
        setRows((prev) => prev.filter((r) => r.id !== id));
      } else {
        toast(json.error || "Could not cancel that follow-up.", "error");
        load();
      }
    } catch {
      toast("Could not cancel that follow-up.", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !rows.length) return null;
  if (!rows.length) return null;

  return (
    <div className="mb-4 rounded-2xl border border-line bg-surface2/50 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <Clock size={15} className="text-muted" />
          {rows.length} instructions SMS scheduled
        </span>
        <span className="text-xs text-muted">{open ? "Hide" : "Show / cancel"}</span>
      </button>

      {open && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => {
            const mins = Math.round((Date.parse(r.scheduledAt) - Date.now()) / 60_000);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-xs">
                <span className="min-w-0 text-ink2">
                  <span className="font-medium text-ink">{r.studentName || "Student"}</span>{" "}
                  <span className="font-mono text-[11px] text-muted">{r.maskedPhone}</span>
                  {" · "}installment no. {r.installmentNo}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-muted" title={formatISTDateTime(r.scheduledAt)}>
                    {mins > 0 ? `in ${mins}m` : "due now"}
                  </span>
                  <button
                    type="button"
                    onClick={() => cancel(r.id)}
                    disabled={busyId === r.id}
                    className="inline-flex items-center gap-1 font-semibold text-danger hover:underline disabled:opacity-50"
                    title="Cancel this scheduled instructions SMS"
                  >
                    {busyId === r.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Cancel
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
