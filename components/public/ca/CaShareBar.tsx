"use client";

import { useEffect, useState } from "react";

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

  const btn = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink2 transition hover:text-ink";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a className={btn} href={`https://wa.me/?text=${shareText}%20${enc(url)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a className={btn} href={`https://t.me/share/url?url=${enc(url)}&text=${shareText}`} target="_blank" rel="noopener noreferrer">Telegram</a>
      <a className={btn} href={`https://twitter.com/intent/tweet?text=${shareText}&url=${enc(url)}`} target="_blank" rel="noopener noreferrer">X</a>
      <a className={btn} href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`} target="_blank" rel="noopener noreferrer">LinkedIn</a>
      <button className={btn} onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
      <button className={`${btn} ${bookmarked ? "border-[var(--gold)] text-[var(--navy)]" : ""}`} onClick={toggleBookmark} disabled={busy} aria-pressed={bookmarked}>
        {bookmarked ? "★ Saved" : "☆ Save"}
      </button>
    </div>
  );
}
