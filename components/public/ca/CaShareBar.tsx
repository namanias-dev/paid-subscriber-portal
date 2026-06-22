"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Send, Share2, Globe, Link2, Check, Bookmark, BookmarkCheck } from "lucide-react";

/** Share + copy-link + bookmark toolbar. Bookmark works for any logged-in user. */
export default function CaShareBar({ slug, title, path }: { slug: string; title: string; path: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUrl(window.location.origin + path);
    fetch(`/api/public/current-affairs/bookmark?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => {
        setLoggedIn(!!d.loggedIn);
        setBookmarked(!!d.bookmarked);
      })
      .catch(() => {});
  }, [slug, path]);

  const enc = encodeURIComponent;
  const shareText = enc(`${title} — UPSC Current Affairs`);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  async function toggleBookmark() {
    if (!loggedIn) {
      window.location.href = `/portal/login?next=${enc(path)}`;
      return;
    }
    setBusy(true);
    const res = await fetch("/api/public/current-affairs/bookmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    const d = await res.json().catch(() => ({ ok: false }));
    setBusy(false);
    if (d.ok) setBookmarked(!!d.bookmarked);
  }

  const btn =
    "ca-focus inline-flex items-center gap-1.5 rounded-full border border-[var(--ca-slate-200)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--ca-slate-700)] transition hover:border-[rgba(212,175,55,0.6)] hover:text-[var(--ca-navy-900)]";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a className={btn} href={`https://wa.me/?text=${shareText}%20${enc(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp"><MessageCircle size={15} /> WhatsApp</a>
      <a className={btn} href={`https://t.me/share/url?url=${enc(url)}&text=${shareText}`} target="_blank" rel="noopener noreferrer" aria-label="Share on Telegram"><Send size={15} /> Telegram</a>
      <a className={btn} href={`https://twitter.com/intent/tweet?text=${shareText}&url=${enc(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on X"><Share2 size={15} /> X</a>
      <a className={btn} href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn"><Globe size={15} /> LinkedIn</a>
      <button className={btn} onClick={copy} aria-label="Copy link">{copied ? <><Check size={15} className="text-[var(--success)]" /> Copied</> : <><Link2 size={15} /> Copy</>}</button>
      <button
        className={`${btn} ${bookmarked ? "border-[rgba(212,175,55,0.7)] bg-[var(--ca-gold-soft)] text-[var(--ca-navy-900)]" : ""}`}
        onClick={toggleBookmark}
        disabled={busy}
        aria-pressed={bookmarked}
        aria-label={bookmarked ? "Remove bookmark" : "Save article"}
      >
        {bookmarked ? <><BookmarkCheck size={15} className="text-[var(--ca-gold)]" /> Saved</> : <><Bookmark size={15} /> Save</>}
      </button>
    </div>
  );
}
