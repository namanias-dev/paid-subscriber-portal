"use client";

import { useEffect, useState } from "react";

/** Thin reading-progress bar fixed under the header for the given content element. */
export default function CaReadingProgress({ targetId }: { targetId: string }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      setPct(total > 0 ? (scrolled / total) * 100 : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [targetId]);

  return (
    <div className="fixed inset-x-0 top-0 z-40 h-1 bg-transparent" aria-hidden="true">
      <div className="h-full bg-[var(--gold)] transition-[width] duration-150" style={{ width: `${pct}%` }} />
    </div>
  );
}
