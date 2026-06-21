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

  if (!ready) {
    return (
      <div className="container-narrow py-16">
        <div className="card mx-auto max-w-md p-6">
          <h1 className="font-heading text-xl font-bold">Before you start</h1>
          <p className="mt-1 text-sm text-ink2">Enter your details to take this free practice test and get your result.</p>
          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => { e.preventDefault(); setGuest(form); setReady(true); }}
          >
            <input className="input" placeholder="Full name" value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Mobile number" value={form.mobile} required onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            <input className="input" type="email" placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <button type="submit" className="btn btn-primary w-full">Start Test →</button>
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
