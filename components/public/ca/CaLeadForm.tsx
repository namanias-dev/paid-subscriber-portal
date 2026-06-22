"use client";

import { useState } from "react";
import { Sparkles, CheckCircle2, Send } from "lucide-react";

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
      <div id="ca-lead" className="ca-dark ca-grain relative scroll-mt-24 overflow-hidden rounded-3xl p-8 text-center">
        <div className="ca-orb" style={{ width: 220, height: 220, top: -100, right: -40, background: "rgba(212,175,55,0.2)" }} />
        <CheckCircle2 size={44} className="mx-auto text-[var(--ca-gold-bright)]" />
        <p className="mt-3 font-heading text-xl font-bold text-white">{msg}</p>
      </div>
    );
  }

  return (
    <div id="ca-lead" className="ca-dark ca-grain relative scroll-mt-24 overflow-hidden rounded-3xl p-7 sm:p-9">
      <div className="ca-orb" style={{ width: 260, height: 260, top: -120, right: -60, background: "rgba(212,175,55,0.16)" }} />
      <div className="relative grid gap-7 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <span className="ca-badge ca-badge-gold"><Sparkles size={13} /> Free resource</span>
          <h3 className="mt-3 font-heading text-2xl font-extrabold tracking-tight text-white sm:text-3xl">{title}</h3>
          <p className="mt-2 max-w-md text-[var(--ca-slate-300)]">{description}</p>
        </div>
        <form onSubmit={submit} className="ca-glass space-y-3 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input ca-focus" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input ca-focus" inputMode="numeric" placeholder="Mobile number*" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          <input className="input ca-focus" placeholder="City (optional)" value={city} onChange={(e) => setCity(e.target.value)} />
          {status === "error" && <p className="text-sm text-[#fca5a5]">{msg}</p>}
          <button type="submit" disabled={status === "loading"} className="ca-btn ca-btn-gold ca-focus w-full">
            <Send size={17} strokeWidth={2} /> {status === "loading" ? "Submitting…" : cta}
          </button>
          <p className="text-center text-xs text-[var(--ca-slate-400)]">No spam. Unsubscribe anytime.</p>
        </form>
      </div>
    </div>
  );
}
