"use client";

import { useEffect, useState } from "react";
import { Link2, Check, MessageCircle, Send } from "lucide-react";

function beacon(ref: string) {
  try {
    fetch("/api/public/resources/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "share", ref }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

export default function ResourceShareBar({ title, path }: { title: string; path: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}${path}`);
  }, [path]);

  const text = encodeURIComponent(`${title} — `);
  const enc = encodeURIComponent(url);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      beacon(path);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ca-slate-400)]">Share</span>
      <a
        href={`https://wa.me/?text=${text}${enc}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => beacon(path)}
        className="ca-focus inline-flex items-center gap-1.5 rounded-full border border-[var(--ca-slate-200)] px-3 py-1.5 text-xs font-semibold text-[var(--ca-slate-700)] transition hover:border-[#25D366] hover:text-[#128C7E]"
      >
        <MessageCircle size={14} /> WhatsApp
      </a>
      <a
        href={`https://t.me/share/url?url=${enc}&text=${text}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => beacon(path)}
        className="ca-focus inline-flex items-center gap-1.5 rounded-full border border-[var(--ca-slate-200)] px-3 py-1.5 text-xs font-semibold text-[var(--ca-slate-700)] transition hover:border-[#229ED9] hover:text-[#229ED9]"
      >
        <Send size={14} /> Telegram
      </a>
      <button
        type="button"
        onClick={copy}
        className="ca-focus inline-flex items-center gap-1.5 rounded-full border border-[var(--ca-slate-200)] px-3 py-1.5 text-xs font-semibold text-[var(--ca-slate-700)] transition hover:border-[var(--ca-navy-600)] hover:text-[var(--ca-navy-900)]"
      >
        {copied ? <><Check size={14} /> Copied</> : <><Link2 size={14} /> Copy link</>}
      </button>
    </div>
  );
}
