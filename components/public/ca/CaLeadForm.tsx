"use client";

import { useState } from "react";

/** Lead-capture form for monthly PDF / daily updates. Phone required. */
export default function CaLeadForm({
  source = "current-affairs",
  title = "Get free monthly Current Affairs PDF",
  description = "Join thousands of aspirants. We'll send the compilation to your WhatsApp.",
  cta = "Send me the PDF",
}: {
  source?: string;
  title?: string;
  description?: string;
  cta?: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[0-9]{10}$/.test(phone.replace(/\D/g, "").slice(-10))) {
      setStatus("error");
      setMsg("Please enter a valid 10-digit mobile number.");
      return;
    }
    setStatus("loading");
    const res = await fetch("/api/public/current-affairs/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, city, source }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    if (d.ok) {
      setStatus("done");
      setMsg("You're in! Check your WhatsApp shortly.");
    } else {
      setStatus("error");
      setMsg(d.error || "Something went wrong. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <div id="ca-lead" className="card scroll-mt-24 border-[var(--gold)] bg-[var(--gold-soft)] p-6 text-center">
        <p className="text-2xl">✅</p>
        <p className="mt-2 font-heading text-lg font-bold text-[var(--navy)]">{msg}</p>
      </div>
    );
  }

  return (
    <form id="ca-lead" onSubmit={submit} className="card scroll-mt-24 p-6">
      <h3 className="font-heading text-xl font-bold text-[var(--navy)]">{title}</h3>
      <p className="mt-1 text-sm text-ink2">{description}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" inputMode="numeric" placeholder="Mobile number*" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        <input className="input sm:col-span-2" placeholder="City (optional)" value={city} onChange={(e) => setCity(e.target.value)} />
      </div>
      {status === "error" && <p className="mt-2 text-sm text-danger">{msg}</p>}
      <button type="submit" disabled={status === "loading"} className="btn btn-primary mt-4 w-full">
        {status === "loading" ? "Submitting…" : cta}
      </button>
      <p className="mt-2 text-center text-xs text-muted">No spam. Unsubscribe anytime.</p>
    </form>
  );
}
