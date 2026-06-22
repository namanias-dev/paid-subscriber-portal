"use client";

import { useEffect, useState } from "react";

interface Heading {
  id: string;
  text: string;
  level: number;
}

/** Builds a table of contents from h2/h3 inside the target element and tracks the active one. */
export default function CaToc({ targetId }: { targetId: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const nodes = Array.from(el.querySelectorAll("h2, h3")) as HTMLElement[];
    const hs: Heading[] = nodes.map((n, i) => {
      if (!n.id) n.id = `ca-h-${i}`;
      n.style.scrollMarginTop = "96px";
      return { id: n.id, text: n.textContent || `Section ${i + 1}`, level: n.tagName === "H3" ? 3 : 2 };
    });
    setHeadings(hs);

    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    nodes.forEach((n) => obs.observe(n));
    return () => obs.disconnect();
  }, [targetId]);

  if (headings.length < 2) return null;

  const list = (
    <nav className="space-y-1.5 text-sm">
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${h.id}`}
          onClick={() => setOpen(false)}
          className={`block border-l-2 py-0.5 transition ${h.level === 3 ? "pl-5" : "pl-3"} ${
            active === h.id ? "border-[var(--gold)] font-semibold text-[var(--navy)]" : "border-line text-ink2 hover:text-ink"
          }`}
        >
          {h.text}
        </a>
      ))}
    </nav>
  );

  return (
    <>
      {/* Mobile: collapsible */}
      <div className="lg:hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold"
          aria-expanded={open}
        >
          On this page
          <span className={`transition ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
        {open && <div className="mt-2 rounded-xl border border-line bg-surface p-3">{list}</div>}
      </div>
      {/* Desktop: sticky */}
      <div className="hidden lg:block">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">On this page</p>
        {list}
      </div>
    </>
  );
}
