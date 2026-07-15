"use client";

import { useEffect, useState } from "react";
import { DEFAULT_POPUP } from "@/lib/homeDefaults";
import type { PopupConfig } from "@/lib/types";

const SEEN_KEY = "naman_home_popup_seen";

/** Returns true if the popup was already dismissed/submitted today. */
function seenToday(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === new Date().toISOString().slice(0, 10);
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, new Date().toISOString().slice(0, 10));
  } catch {
    /* ignore */
  }
}

export default function LeadPopup({ config }: { config?: PopupConfig }) {
  const cfg = { ...DEFAULT_POPUP, ...(config || {}) };
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [interest, setInterest] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg.enabled || seenToday()) return;
    const delay = Math.min(120, Math.max(0, Number(cfg.delay_seconds ?? 5))) * 1000;
    const t = setTimeout(() => setOpen(true), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.enabled, cfg.delay_seconds]);

  if (!cfg.enabled || !open) return null;

  function close() {
    markSeen();
    setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !/^[6-9]\d{9}$/.test(phone)) {
      setError("Enter your name and a valid 10-digit mobile (starting 6–9).");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/public/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone,
          email: email.trim() || undefined,
          course_interest: interest || undefined,
          source: "home_popup",
          campaign: "Home Popup",
          source_form: "lead_popup",
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        markSeen();
        setDone(true);
      } else {
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={cfg.heading}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <button onClick={close} aria-label="Close" className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface text-ink2 hover:bg-line">✕</button>

        <div className="px-6 pt-7 text-center text-white" style={{ background: "linear-gradient(135deg,#0057FF,#3D8BFF)" }}>
          <p className="text-xs font-bold uppercase tracking-wider text-white/80">Limited time</p>
          <h3 className="mt-1 font-heading text-2xl font-extrabold text-white">{cfg.heading}</h3>
          <p className="mx-auto mt-1 max-w-xs pb-6 text-sm text-white/90">{cfg.subtext}</p>
        </div>

        <div className="p-6">
          {done ? (
            <div className="py-6 text-center">
              <div className="mb-2 text-4xl">🎉</div>
              <p className="text-ink2">{cfg.success_message}</p>
              <button onClick={close} className="btn btn-primary mt-5 w-full">Done</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
              <input
                className="input"
                placeholder="10-digit mobile"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
              <input className="input" type="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
              {(cfg.interest_options || []).length > 0 && (
                <select className="input" value={interest} onChange={(e) => setInterest(e.target.value)}>
                  <option value="">I&apos;m interested in…</option>
                  {(cfg.interest_options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {error && <p className="text-sm text-danger">{error}</p>}
              <button type="submit" disabled={loading} className="btn btn-saffron w-full text-base">
                {loading ? "Submitting…" : cfg.button_text}
              </button>
              <p className="text-center text-[11px] text-muted">We respect your privacy. No spam.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
