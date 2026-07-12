"use client";

import type { PortalLink } from "@/lib/portal/links";

/**
 * Consistent "Open in Portal" buttons. NAVIGATION ONLY — each opens a real namanias.com
 * admin page in a new tab; AIVA never takes an action. List-level links show a subtle dot
 * so it's clear the portal can't deep-link to that exact record.
 */
export default function OpenInPortal({ links, size = "sm" }: { links: PortalLink[]; size?: "sm" | "xs" }) {
  if (!links || links.length === 0) return null;
  const pad = size === "xs" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";
  return (
    <div className="flex flex-wrap gap-1.5">
      {links.map((l) => (
        <a
          key={l.key}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`aiva-portal-btn ${pad}`}
          title={l.level === "list" ? `${l.label} (portal list — no record-level URL)` : l.label}
        >
          {l.label}
          <span className="aiva-portal-ext" aria-hidden>↗</span>
          {l.level === "list" ? <span className="aiva-portal-listdot" aria-hidden title="list-level only" /> : null}
        </a>
      ))}
    </div>
  );
}
