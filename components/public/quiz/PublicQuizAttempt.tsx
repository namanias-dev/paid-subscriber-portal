"use client";

import { useState } from "react";
import AttemptEngine from "./AttemptEngine";

type Step = "form" | "code" | "quiz";

export default function PublicQuizAttempt({
  slug,
  quizTitle,
  isLoggedIn,
}: {
  slug: string;
  quizTitle?: string;
  /** kept for API compatibility; the gate is driven purely by login state now. */
  captureLead?: boolean;
  isLoggedIn: boolean;
}) {
  // SECURITY: anonymous attempts are never allowed. A logged-out visitor MUST
  // pass the lead form (which creates their account + logs them in) before the
  // quiz starts. The server enforces this too — this is just the matching UX.
  const [step, setStep] = useState<Step>(isLoggedIn ? "quiz" : "form");
  const [form, setForm] = useState({ name: "", mobile: "", email: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginCode, setLoginCode] = useState<string | null>(null);
  const [isNewCode, setIsNewCode] = useState(true);
  const [copied, setCopied] = useState(false);

  const mobileValid = /^[6-9]\d{9}$/.test(form.mobile);
  const canStart = form.name.trim().length > 1 && mobileValid;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart || submitting) return;
    setError(null);
    setSubmitting(true);

    // Create-or-reuse a re-loggable account AND log in (server sets the session
    // cookie), so the subsequent quiz start is authenticated and the attempt is
    // tied to this student. We must NOT proceed if this fails.
    try {
      const res = await fetch("/api/public/quiz/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          mobile: form.mobile,
          email: form.email.trim() || undefined,
          interest: quizTitle,
          slug,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      setSubmitting(false);
      if (!data.ok || !data.loginCode) {
        setError(data.error || "Could not start. Please check your details and try again.");
        return;
      }
      setLoginCode(data.loginCode as string);
      setIsNewCode(!!data.isNew);
      setStep("code");
    } catch {
      setSubmitting(false);
      setError("Network error. Please try again.");
    }
  }

  async function copyCode() {
    if (!loginCode) return;
    try {
      await navigator.clipboard.writeText(loginCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked — code is visible on screen anyway */
    }
  }

  // ---- Step 1: lead form ----
  if (step === "form") {
    return (
      <div className="container-narrow py-12 sm:py-16">
        <div className="card mx-auto max-w-md overflow-hidden p-0">
          <div className="bg-gradient-to-br from-primary to-primary-hover px-6 py-6 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Free practice test</p>
            <h1 className="mt-1 font-heading text-xl font-bold">Before you start</h1>
            {quizTitle && <p className="mt-1 text-sm text-white/85">{quizTitle}</p>}
          </div>
          <form className="space-y-3 p-6" onSubmit={submit}>
            <p className="text-sm text-ink2">Enter your details to take this free test and unlock your instant result &amp; explanations. We&apos;ll create a personal login so you can come back and track all your tests.</p>
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
            {error && <p className="text-sm text-danger">{error}</p>}
            <button type="submit" disabled={!canStart || submitting} className="btn btn-primary w-full py-3 disabled:opacity-50">
              {submitting ? "Preparing…" : "Continue →"}
            </button>
            <p className="text-center text-xs text-muted">
              Already have a login code? <a href={`/login?next=/quizzes/${slug}`} className="font-semibold text-primary underline">Log in</a>
            </p>
            <p className="text-center text-xs text-muted">We respect your privacy. No spam — just your result and useful UPSC updates.</p>
          </form>
        </div>
      </div>
    );
  }

  // ---- Step 2: save your login code ----
  if (step === "code" && loginCode) {
    return (
      <div className="container-narrow py-12 sm:py-16">
        <div className="card mx-auto max-w-md overflow-hidden p-0">
          <div className="bg-gradient-to-br from-primary to-primary-hover px-6 py-6 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/80">{isNewCode ? "Your login is ready" : "Welcome back"}</p>
            <h1 className="mt-1 font-heading text-xl font-bold">Save your login code</h1>
            <p className="mt-1 text-sm text-white/85">You&apos;re logged in. Use it to log back in anytime and retake quizzes or see your results.</p>
          </div>
          <div className="space-y-5 p-6 text-center">
            <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary-tint/40 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your login code</p>
              <p className="mt-2 select-all font-mono text-3xl font-extrabold tracking-[0.3em] text-primary">{loginCode}</p>
              <button type="button" onClick={copyCode} className="btn btn-secondary mt-4">
                {copied ? "✓ Copied" : "Copy code"}
              </button>
            </div>
            <div className="rounded-xl bg-amber-50 p-4 text-left text-sm text-amber-900">
              <p className="font-semibold">⚠ Save this code now.</p>
              <p className="mt-1">
                Log in later at <span className="font-mono font-semibold">/login</span> with your mobile{" "}
                <span className="font-semibold">{form.mobile}</span> and this code. Lost it? Just start any test again with the same mobile number to see it.
              </p>
            </div>
            <button type="button" onClick={() => setStep("quiz")} className="btn btn-primary w-full py-3">
              I&apos;ve saved it — Start the test →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Step 3: the quiz (authenticated — server ties the attempt to the student) ----
  return (
    <AttemptEngine
      apiBase="/api/public/quiz"
      slug={slug}
      resultBase={`/quizzes/${slug}/result`}
    />
  );
}
