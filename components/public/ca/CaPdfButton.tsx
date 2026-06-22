"use client";

import { useState } from "react";
import { Download, FileText, Lock } from "lucide-react";
import type { CaPdf } from "@/lib/types";

/** Download button that tracks the download and enforces login/lead gating. */
export default function CaPdfButton({ pdf }: { pdf: CaPdf }) {
  const [busy, setBusy] = useState(false);
  const [needLead, setNeedLead] = useState(false);
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");

  async function go(leadPhone?: string) {
    setBusy(true);
    setErr("");
    const res = await fetch("/api/public/current-affairs/pdf-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pdf.id, phone: leadPhone }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    setBusy(false);
    if (d.ok && d.url) {
      window.open(d.url, "_blank", "noopener,noreferrer");
      setNeedLead(false);
    } else if (d.requiresLead) {
      setNeedLead(true);
    } else if (d.requiresLogin) {
      window.location.href = `/portal/login?next=${encodeURIComponent(window.location.pathname)}`;
    } else {
      setErr(d.error || "Unable to download right now.");
    }
  }

  const gated = pdf.requires_lead || pdf.requires_login;
  const gating = pdf.requires_lead ? "Free with mobile number" : pdf.requires_login ? "Login required" : "Free download";

  return (
    <div className="rounded-2xl border border-[var(--ca-slate-200)] bg-white p-4 transition hover:border-[rgba(212,175,55,0.5)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="ca-icon-chip ca-icon-chip--light shrink-0" style={{ width: 38, height: 38 }}>
            <FileText size={18} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-[var(--ca-navy-900)]">{pdf.title}</p>
            <p className="flex items-center gap-1 text-xs text-[var(--ca-slate-400)]">
              {gated && <Lock size={11} />}
              {gating}{pdf.download_count ? ` · ${pdf.download_count} downloads` : ""}
            </p>
          </div>
        </div>
        <button onClick={() => go()} disabled={busy} className="ca-btn ca-btn-gold ca-focus shrink-0 px-3.5 py-2 text-sm" aria-label={`Download ${pdf.title}`}>
          <Download size={16} strokeWidth={2} /> {busy ? "…" : "Get"}
        </button>
      </div>
      {needLead && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="input ca-focus flex-1" inputMode="numeric" placeholder="Enter mobile to unlock" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button onClick={() => go(phone)} disabled={busy} className="ca-btn ca-btn-outline ca-focus px-4 text-sm">Unlock</button>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-[var(--danger)]">{err}</p>}
    </div>
  );
}
