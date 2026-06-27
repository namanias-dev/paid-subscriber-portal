"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Elegant top progress indicator that kills perceived nav lag. It starts the
 * instant an internal link is clicked (immediate feedback) and completes when the
 * new route commits (pathname change). Pure CSS width/opacity transitions — no
 * library, GPU-friendly, and a no-op for prefers-reduced-motion users (the bar
 * still appears but without easing, handled in CSS).
 */
export default function RouteProgress() {
  const pathname = usePathname();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const rampRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);

  const clearTimers = () => {
    if (rampRef.current) { clearInterval(rampRef.current); rampRef.current = null; }
    if (hideRef.current) { clearTimeout(hideRef.current); hideRef.current = null; }
  };

  const start = () => {
    clearTimers();
    activeRef.current = true;
    setVisible(true);
    setWidth(8);
    rampRef.current = setInterval(() => {
      setWidth((w) => (w < 88 ? w + Math.max(0.4, (92 - w) * 0.06) : w));
    }, 180);
  };

  const finish = () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    clearTimers();
    setWidth(100);
    hideRef.current = setTimeout(() => { setVisible(false); setWidth(0); }, 280);
  };

  // Begin on any internal, same-tab link click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a");
      if (!a) return;
      const href = a.getAttribute("href");
      const target = a.getAttribute("target");
      if (!href || href.startsWith("#") || target === "_blank" || a.hasAttribute("download")) return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname) return; // same page / hash
      } catch { return; }
      start();
    }
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("click", onClick, true); clearTimers(); };
  }, []);

  // Route committed → complete the bar.
  useEffect(() => { finish(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pathname]);

  if (!visible) return null;
  return (
    <div className="nsa-progress" aria-hidden="true">
      <div className="nsa-progress__bar" style={{ width: `${width}%` }} />
    </div>
  );
}
