"use client";

import { useEffect, useState } from "react";
import AttemptEngine from "./AttemptEngine";

const LEAD_KEY = "nsa_quiz_lead";

type GuestLead = { name?: string; email?: string; mobile?: string; interest?: string };

export default function PublicQuizAttempt({
  slug,
  quizTitle,
  captureLead,
  isLoggedIn,
}: {
  slug: string;
  quizTitle?: string;
  captureLead: boolean;
  isLoggedIn: boolean;
}) {
  const needGate = captureLead && !isLoggedIn;
  const [ready, setReady] = useState(!needGate);
  const [guest, setGuest] = useState<GuestLead | null>(null);
  const [form, setForm] = useState({ name: "", mobile: "", email: "" });

  // Remember a lead within the same browser session so we don't re-ask every quiz.
  useEffect(() => {
    if (!needGate) return;
    try {
      const raw = sessionStorage.getItem(LEAD_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { name?: string; mobile?: string; email?: string };
      if (saved?.name && /^[6-9]\d{9}$/.test(saved.mobile || "")) {
        setForm({ name: saved.name, mobile: saved.mobile || "", email: saved.email || "" });
        setGuest({ ...saved, interest: quizTitle });
        setReady(true);
      }
    } catch {
      /* ignore */
    }
  }, [needGate, quizTitle]);

  const mobileValid = /^[6-9]\d{9}$/.test(form.mobile);
  const canStart = form.name.trim().length > 1 && mobileValid;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart) return;
    const lead: GuestLead = { name: form.name.trim(), mobile: form.mobile, email: form.email.trim() || undefined, interest: quizTitle };
    try {
      sessionStorage.setItem(LEAD_KEY, JSON.stringify({ name: lead.name, mobile: lead.mobile, email: lead.email }));
    } catch {
      /* ignore */
    }
    setGuest(lead);
    setReady(true);
  }

  if (!ready) {
    return (
      <div className="container-narrow py-12 sm:py-16">
        <div className="card mx-auto max-w-md overflow-hidden p-0">
          <div className="bg-gradient-to-br from-primary to-primary-hover px-6 py-6 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Free practice test</p>
            <h1 className="mt-1 font-heading text-xl font-bold">Before you start</h1>
            {quizTitle && <p className="mt-1 text-sm text-white/85">{quizTitle}</p>}
          </div>
          <form className="space-y-3 p-6" onSubmit={submit}>
            <p className="text-sm text-ink2">Enter your details to take this free test and unlock your instant result &amp; explanations.</p>
            <div>
              <label className="label">Full Name *</label>
              <input className="input" placeholder="Your full name" value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Mobile Number *</label>
              <input
                className="input"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={form.mobile}
                required
                onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
              />
              <p className="mt-1 text-xs text-muted">Enter 10-digit Indian mobile number</p>
              {form.mobile.length > 0 && !mobileValid && (
                <p className="mt-1 text-xs text-danger">Please enter a valid 10-digit mobile number.</p>
              )}
            </div>
            <div>
              <label className="label">Email (optional)</label>
              <input className="input" type="email" placeholder="you@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <button type="submit" disabled={!canStart} className="btn btn-primary w-full py-3 disabled:opacity-50">Start Test →</button>
            <p className="text-center text-xs text-muted">We respect your privacy. No spam — just your result and useful UPSC updates.</p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <AttemptEngine
      apiBase="/api/public/quiz"
      slug={slug}
      resultBase={`/quizzes/${slug}/result`}
      guest={guest}
    />
  );
}
