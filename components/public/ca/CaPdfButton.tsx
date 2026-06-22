"use client";

import { useState } from "react";
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

  const gating = pdf.requires_lead ? "Free with mobile number" : pdf.requires_login ? "Login required" : "Free";

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{pdf.title}</p>
          <p className="text-xs text-muted">{gating}{pdf.download_count ? ` · ${pdf.download_count} downloads` : ""}</p>
        </div>
        <button onClick={() => go()} disabled={busy} className="btn btn-secondary shrink-0 text-sm">
          {busy ? "…" : "⬇ Download"}
        </button>
      </div>
      {needLead && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="input flex-1" inputMode="numeric" placeholder="Enter mobile to unlock" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button onClick={() => go(phone)} disabled={busy} className="btn btn-primary text-sm">Unlock</button>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
}
