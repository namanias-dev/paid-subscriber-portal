"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { PhoneAudienceId } from "@/lib/adminPhoneAudiences";

type TfMode = "today" | "7d" | "30d" | "year" | "custom";

interface AudienceMeta { id: PhoneAudienceId; label: string; definition: string }
interface PreviewRow { phone: string; name: string | null; stage: string | null }

const TF_OPTS: { id: TfMode; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "year", label: "This year" },
  { id: "custom", label: "Custom range" },
];

async function copyText(text: string): Promise<"clipboard" | "execCommand" | "manual" | "failed"> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    } catch {
      /* fall through */
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return "execCommand";
  } catch {
    /* fall through */
  }
  return "failed";
}

export default function CopyPhonesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [audiences, setAudiences] = useState<AudienceMeta[]>([]);
  const [audience, setAudience] = useState<PhoneAudienceId | "">("");
  const [tf, setTf] = useState<TfMode>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [countsBusy, setCountsBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [clipboardText, setClipboardText] = useState("");
  const [total, setTotal] = useState(0);
  const [capped, setCapped] = useState(false);
  const [copyCap, setCopyCap] = useState(2000);
  const [listBusy, setListBusy] = useState(false);
  const [manualText, setManualText] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/leads/phone-audience")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setAudiences(d.audiences || []);
          setCopyCap(d.copyCap || 2000);
          if (!audience && d.audiences?.[0]) setAudience(d.audiences[0].id);
        }
      })
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchCounts = useCallback(() => {
    if (!open) return;
    setCountsBusy(true);
    const body: Record<string, string> = { action: "counts", mode: tf };
    if (tf === "custom") { body.from = from; body.to = to; }
    fetch("/api/admin/leads/phone-audience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setCounts(d.counts || {}); })
      .catch(() => null)
      .finally(() => setCountsBusy(false));
  }, [open, tf, from, to]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCounts(), 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [fetchCounts, open]);

  // Prefetch full list into memory when audience+timeframe ready (Step C data).
  useEffect(() => {
    if (!open || !audience) return;
    if (tf === "custom" && (!from || !to)) return;
    setListBusy(true);
    setManualText(null);
    const body: Record<string, string> = { action: "list", audience, mode: tf };
    if (tf === "custom") { body.from = from; body.to = to; }
    fetch("/api/admin/leads/phone-audience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        setPreview(d.preview || []);
        setTotal(d.total || 0);
        setCapped(!!d.capped);
        setClipboardText(d.clipboardText || "");
      })
      .catch(() => null)
      .finally(() => setListBusy(false));
  }, [open, audience, tf, from, to]);

  async function onCopyClick() {
    if (capped) {
      toast(`Too many numbers (${total}). Narrow the timeframe (cap ${copyCap}).`, "error");
      return;
    }
    if (!clipboardText) {
      toast("No numbers to copy.", "error");
      return;
    }
    // CRITICAL: no awaits before clipboard write — text is already in state.
    const result = await copyText(clipboardText);
    if (result === "failed") {
      setManualText(clipboardText);
      toast("Clipboard blocked — select all and copy manually below.", "error");
      return;
    }
    toast(`Copied ${total} number${total === 1 ? "" : "s"}`, "success");
    // Log after successful copy (network after clipboard is fine).
    void fetch("/api/admin/leads/phone-audience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "copied", audience, count: total, mode: tf }),
    }).catch(() => null);
  }

  return (
    <Modal open={open} onClose={onClose} title="Copy phone numbers" maxWidth="max-w-3xl">
      <div className="space-y-6">
        {/* Step A */}
        <section>
          <h4 className="text-sm font-semibold text-ink">Audience</h4>
          <div className="mt-3 space-y-2">
            {audiences.map((a) => (
              <label key={a.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${audience === a.id ? "border-primary bg-primary/5" : "border-line hover:border-ink2/30"}`}>
                <input
                  type="radio"
                  className="mt-1"
                  name="phone-aud"
                  checked={audience === a.id}
                  onChange={() => setAudience(a.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">{a.label}</span>
                    <span className="tabular-nums text-sm font-semibold text-ink">
                      {countsBusy && !counts ? "…" : (counts?.[a.id] ?? "—")}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{a.definition}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* Step B */}
        <section>
          <h4 className="text-sm font-semibold text-ink">Timeframe</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {TF_OPTS.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setTf(o.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${tf === o.id ? "border-primary bg-ink text-white" : "border-line bg-white text-ink2"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {tf === "custom" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          )}
          <p className="mt-1.5 text-xs text-muted">Asia/Kolkata · half-open day bounds. Changing timeframe re-counts all audiences.</p>
        </section>

        {/* Step C */}
        <section className="rounded-xl border border-line bg-surface2/40 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-ink">Preview + Copy</h4>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink">
                {listBusy ? "…" : total}
                <span className="ml-2 text-sm font-medium text-muted">unique numbers</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onCopyClick()}
              disabled={listBusy || capped || total === 0}
              className="btn btn-primary disabled:opacity-50"
            >
              Copy to Clipboard
            </button>
          </div>
          {capped && (
            <p className="mt-2 text-sm text-danger">
              {total} numbers exceeds the {copyCap} cap — narrow the timeframe before copying.
            </p>
          )}
          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Stage</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.phone} className="border-b border-line/60">
                    <td className="px-3 py-1.5">{r.name || "—"}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">{r.phone}</td>
                    <td className="px-3 py-1.5 text-ink2">{r.stage || "—"}</td>
                  </tr>
                ))}
                {!listBusy && preview.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-4 text-center text-muted">No matches</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {manualText != null && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-semibold text-ink">Select all and copy manually</p>
              <textarea
                readOnly
                className="input min-h-[120px] font-mono text-xs"
                value={manualText}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
