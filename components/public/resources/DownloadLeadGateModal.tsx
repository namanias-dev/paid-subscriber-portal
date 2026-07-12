"use client";

/**
 * Premium, mobile-first lead-capture modal shown BEFORE a gated free download.
 * ONE short step: Name / Phone / City required; a few clearly-skippable optional
 * questions; a marketing-consent line (nsa_consent convention) before phone use.
 *
 * On success it writes to the shared lead infra via /api/public/downloads/lead
 * (source="free_download", dedupe by phone) and fires ONLY the PII-free
 * `download_lead_submit` analytics event (file id/kind — never name/phone).
 * Reduced-motion safe (entrance animation only when motion is allowed).
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CaPdf } from "@/lib/types";
import { normalizeIndianMobile } from "@/lib/phone";
import { CONSENT } from "@/lib/ai-agent/copyLibrary";
import { trackClient } from "@/lib/analytics/client";

const CURRENT_YEAR = new Date().getFullYear();
const TARGET_YEARS = [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2, CURRENT_YEAR + 3];

export default function DownloadLeadGateModal({
  pdf,
  onSubmitted,
  onClose,
}: {
  pdf: CaPdf;
  /** Called after a successful save; receives the validated 10-digit phone. */
  onSubmitted: (phone: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [targetYear, setTargetYear] = useState("");
  const [decided, setDecided] = useState<"" | "yes" | "exploring">("");
  const [mode, setMode] = useState<"" | "online" | "offline">("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reduceMotion, setReduceMotion] = useState(true);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // PII-free prompt signal.
    trackClient("download_lead_prompt", { pdf_id: pdf.id, kind: pdf.kind, surface: "resources_downloads" });
    if (typeof window !== "undefined" && window.matchMedia) {
      setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    firstFieldRef.current?.focus();
    // Lock background scroll while the modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pdf.id, pdf.kind]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    setErr("");
    if (!name.trim()) return setErr("Please enter your name.");
    const n = normalizeIndianMobile(phone);
    if (!n.ok) return setErr(n.error || "Enter a valid 10-digit mobile number.");
    if (!city.trim()) return setErr("Please enter your city.");

    setBusy(true);
    try {
      const res = await fetch("/api/public/downloads/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          city: city.trim(),
          target_year: targetYear || undefined,
          decided: decided || undefined,
          mode: mode || undefined,
          consent_marketing: consent || undefined,
          file: { id: pdf.id, title: pdf.title, kind: pdf.kind },
        }),
      });
      const d = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !d.ok) {
        setErr(d.error || "Could not save right now. Please try again.");
        setBusy(false);
        return;
      }
      // PII-free submit signal (file id/kind only — never name/phone).
      trackClient("download_lead_submit", { pdf_id: pdf.id, kind: pdf.kind, surface: "resources_downloads" });
      onSubmitted(n.digits10!);
    } catch {
      setErr("Network problem — please try again.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dl-lead-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        style={reduceMotion ? undefined : { animation: "dlgate-fade 180ms ease-out" }}
      />
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        style={reduceMotion ? undefined : { animation: "dlgate-rise 220ms cubic-bezier(0.16,1,0.3,1)" }}
      >
        {/* Navy header */}
        <div
          className="relative px-5 pb-4 pt-5 text-white"
          style={{ background: "linear-gradient(90deg, var(--ca-navy-900, #0b1f3a), var(--ca-navy-600, #1e3a68))" }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ca-focus absolute right-3 top-3 rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
          <h3 id="dl-lead-title" className="pr-8 text-lg font-bold leading-snug">
            Get this free download
          </h3>
          <p className="mt-1 text-sm text-white/80">
            Tell us where to send more free UPSC material. Takes 10 seconds — then your file opens.
          </p>
        </div>

        <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
          <div className="space-y-2.5">
            <input
              ref={firstFieldRef}
              className="input ca-focus w-full"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            <input
              className="input ca-focus w-full"
              placeholder="Mobile number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="numeric"
              autoComplete="tel"
            />
            <input
              className="input ca-focus w-full"
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              autoComplete="address-level2"
            />
          </div>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-slate-400,#7a8699)]">
            Optional — helps us guide you better
          </p>
          <div className="mt-2 space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-[var(--ca-slate-400,#7a8699)]">Which UPSC year are you targeting?</span>
              <select
                className="input ca-focus w-full"
                value={targetYear}
                onChange={(e) => setTargetYear(e.target.value)}
              >
                <option value="">Not sure yet</option>
                {TARGET_YEARS.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>

            <div>
              <span className="mb-1 block text-xs text-[var(--ca-slate-400,#7a8699)]">Have you decided to prepare?</span>
              <div className="flex flex-wrap gap-2">
                <Chip active={decided === "yes"} onClick={() => setDecided(decided === "yes" ? "" : "yes")}>Yes</Chip>
                <Chip active={decided === "exploring"} onClick={() => setDecided(decided === "exploring" ? "" : "exploring")}>Still exploring</Chip>
              </div>
            </div>

            <div>
              <span className="mb-1 block text-xs text-[var(--ca-slate-400,#7a8699)]">Online or Offline?</span>
              <div className="flex flex-wrap gap-2">
                <Chip active={mode === "online"} onClick={() => setMode(mode === "online" ? "" : "online")}>Online</Chip>
                <Chip active={mode === "offline"} onClick={() => setMode(mode === "offline" ? "" : "offline")}>Offline</Chip>
              </div>
            </div>
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl bg-[var(--ca-slate-50,#f4f6fa)] p-3 text-[11px] leading-relaxed text-[var(--ca-slate-500,#556)]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              aria-label="I agree to be contacted about my UPSC preparation"
            />
            <span>{CONSENT.body}</span>
          </label>

          {err && <p className="mt-2 text-sm text-[var(--danger,#c0392b)]">{err}</p>}
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--ca-slate-100,#e6eaf2)] px-5 py-4">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="ca-btn ca-btn-gold ca-focus w-full justify-center py-3 text-sm font-semibold"
          >
            {busy ? "Saving…" : "Get my download"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ca-focus w-full rounded-lg py-2 text-sm text-[var(--ca-slate-400,#7a8699)] hover:text-[var(--ca-navy-900,#0b1f3a)]"
          >
            Maybe later
          </button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes dlgate-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dlgate-rise {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes dlgate-rise { from { opacity: 1; transform: none; } to { opacity: 1; transform: none; } }
          @keyframes dlgate-fade { from { opacity: 1; } to { opacity: 1; } }
        }
      `}</style>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`ca-focus rounded-full border px-4 py-2 text-sm transition ${
        active
          ? "border-[var(--ca-gold-bright,#c8a24a)] bg-[var(--ca-gold-bright,#c8a24a)]/15 font-semibold text-[var(--ca-navy-900,#0b1f3a)]"
          : "border-[var(--ca-slate-200,#d4dae6)] text-[var(--ca-slate-500,#556)] hover:border-[var(--ca-navy-600,#1e3a68)]"
      }`}
    >
      {children}
    </button>
  );
}
