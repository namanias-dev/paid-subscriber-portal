"use client";

import { useState } from "react";
import AttemptEngine from "./AttemptEngine";

export default function PublicQuizAttempt({
  slug,
  captureLead,
  isLoggedIn,
}: {
  slug: string;
  captureLead: boolean;
  isLoggedIn: boolean;
}) {
  const needGate = captureLead && !isLoggedIn;
  const [ready, setReady] = useState(!needGate);
  const [guest, setGuest] = useState<{ name?: string; email?: string; mobile?: string } | null>(null);
  const [form, setForm] = useState({ name: "", mobile: "", email: "" });

  const mobileValid = /^[6-9]\d{9}$/.test(form.mobile);
  const canStart = form.name.trim().length > 1 && mobileValid;

  if (!ready) {
    return (
      <div className="container-narrow py-16">
        <div className="card mx-auto max-w-md p-6">
          <h1 className="font-heading text-xl font-bold">Before you start</h1>
          <p className="mt-1 text-sm text-ink2">Enter your details to take this free practice test and get your result.</p>
          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (canStart) { setGuest(form); setReady(true); } }}
          >
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
            <button type="submit" disabled={!canStart} className="btn btn-primary w-full disabled:opacity-50">Start Test →</button>
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
