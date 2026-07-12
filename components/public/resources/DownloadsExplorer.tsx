"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Download, FileText, Lock, Search } from "lucide-react";
import type { CaPdf, CaPdfKind } from "@/lib/types";
import { trackClient } from "@/lib/analytics/client";
import {
  incFreeDownloadCount,
  markLeadCaptured,
  shouldGateDownload,
} from "@/lib/downloads/leadGate";
import DownloadLeadGateModal from "./DownloadLeadGateModal";

/** Resolves once the visitor is allowed to proceed with a download. */
type EnsureLead = (pdf: CaPdf) => Promise<{ ok: boolean; phone?: string }>;

const KIND_LABEL: Record<CaPdfKind, string> = {
  monthly: "Monthly Compilations",
  daily: "Daily Notes",
  general: "Notes & Booklets",
};

const FILTERS: { id: "all" | CaPdfKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "monthly", label: "Monthly" },
  { id: "daily", label: "Daily" },
  { id: "general", label: "Notes" },
];

/** One downloadable file row — reuses the CA download API (gating + count) and
 *  fires a PII-free `resource_download_click` on success. */
function DownloadRow({ pdf, ensureLead }: { pdf: CaPdf; ensureLead: EnsureLead }) {
  const [busy, setBusy] = useState(false);
  const [needLead, setNeedLead] = useState(false);
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");

  async function go(leadPhone?: string) {
    setBusy(true);
    setErr("");
    try {
      // Smart session lead gate: frictionless first download, ONE short form on
      // a later download. Real access gates stay server-side (below) — untouched.
      const gate = await ensureLead(pdf);
      if (!gate.ok) {
        setBusy(false);
        return;
      }
      const phoneForDownload = leadPhone || gate.phone;
      const res = await fetch("/api/public/current-affairs/pdf-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pdf.id, phone: phoneForDownload }),
      });
      const d = await res.json().catch(() => ({ ok: false }));
      if (d.ok && d.url) {
        // PII-free download signal for the first-party analytics pipeline.
        trackClient("resource_download_click", { pdf_id: pdf.id, kind: pdf.kind, surface: "resources_downloads" });
        incFreeDownloadCount();
        window.open(d.url, "_blank", "noopener,noreferrer");
        setNeedLead(false);
      } else if (d.requiresLead) {
        setNeedLead(true);
      } else if (d.requiresLogin) {
        window.location.href = `/portal/login?next=${encodeURIComponent(window.location.pathname)}`;
      } else {
        setErr(d.error || "Unable to download right now.");
      }
    } catch {
      setErr("Unable to download right now.");
    } finally {
      setBusy(false);
    }
  }

  const gated = pdf.requires_lead || pdf.requires_login;
  const gating = pdf.requires_lead ? "Free with mobile number" : pdf.requires_login ? "Login required" : "Free download";

  return (
    <div className="ca-card overflow-hidden p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3 sm:items-center">
          <span className="ca-icon-chip ca-icon-chip--light shrink-0" style={{ width: 42, height: 42 }}>
            <FileText size={19} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="line-clamp-2 font-semibold text-[var(--ca-navy-900)]">{pdf.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ca-slate-400)]">
              <span className="ca-filter px-2 py-0.5 text-[11px]">{KIND_LABEL[pdf.kind]}</span>
              {pdf.date_ref && <span className="truncate">{pdf.date_ref}</span>}
              <span className="inline-flex items-center gap-1">
                {gated && <Lock size={11} className="shrink-0" />}
                {gating}
              </span>
              {pdf.download_count ? <span className="truncate">· {pdf.download_count.toLocaleString("en-IN")} downloads</span> : null}
            </p>
          </div>
        </div>
        <button
          onClick={() => go()}
          disabled={busy}
          className="ca-btn ca-btn-gold ca-focus w-full shrink-0 justify-center px-4 py-2.5 text-sm sm:w-auto"
          aria-label={`Download ${pdf.title}`}
        >
          <Download size={16} strokeWidth={2} /> {busy ? "…" : "Download"}
        </button>
      </div>
      {needLead && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="input ca-focus flex-1"
            inputMode="numeric"
            placeholder="Enter mobile to unlock"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button onClick={() => go(phone)} disabled={busy} className="ca-btn ca-btn-outline ca-focus px-4 text-sm">
            Unlock
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-[var(--danger)]">{err}</p>}
    </div>
  );
}

export default function DownloadsExplorer({ pdfs }: { pdfs: CaPdf[] }) {
  const [filter, setFilter] = useState<"all" | CaPdfKind>("all");
  const [q, setQ] = useState("");
  const [gatePdf, setGatePdf] = useState<CaPdf | null>(null);
  const resolverRef = useRef<((r: { ok: boolean; phone?: string }) => void) | null>(null);

  const ensureLead = useCallback<EnsureLead>((pdf) => {
    return new Promise((resolve) => {
      if (!shouldGateDownload()) {
        resolve({ ok: true });
        return;
      }
      resolverRef.current = resolve;
      setGatePdf(pdf);
    });
  }, []);

  const handleGateSubmitted = useCallback((leadPhone: string) => {
    markLeadCaptured();
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setGatePdf(null);
    resolve?.({ ok: true, phone: leadPhone });
  }, []);

  const handleGateClose = useCallback(() => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setGatePdf(null);
    resolve?.({ ok: false });
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: pdfs.length, monthly: 0, daily: 0, general: 0 };
    for (const p of pdfs) c[p.kind] = (c[p.kind] || 0) + 1;
    return c;
  }, [pdfs]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return pdfs.filter((p) => {
      if (filter !== "all" && p.kind !== filter) return false;
      if (term && !`${p.title} ${p.date_ref || ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [pdfs, filter, q]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {FILTERS.filter((f) => f.id === "all" || counts[f.id]).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`ca-filter ca-focus ${filter === f.id ? "ca-filter--active" : ""}`}
            >
              {f.label}
              <span className="ml-1.5 opacity-70">{counts[f.id] || 0}</span>
            </button>
          ))}
        </div>
        <label className="relative block w-full sm:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ca-slate-400)]" />
          <input
            className="input ca-focus w-full pl-9"
            placeholder="Search downloads…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="py-16 text-center text-[var(--ca-slate-400)]">No downloads match your search yet.</p>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {visible.map((p) => (
            <DownloadRow key={p.id} pdf={p} ensureLead={ensureLead} />
          ))}
        </div>
      )}

      {gatePdf && (
        <DownloadLeadGateModal pdf={gatePdf} onSubmitted={handleGateSubmitted} onClose={handleGateClose} />
      )}
    </div>
  );
}
