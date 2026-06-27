"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { formatISTDateTime } from "@/lib/dates";

export interface TimelineNode {
  id: string;
  /** Tailwind bg class for the status dot, e.g. "bg-success". */
  dot?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Status pill / chips, right-aligned with `right`. */
  badge?: ReactNode;
  /** Amount or primary right-aligned value. */
  right?: ReactNode;
  /** ISO timestamp, rendered in IST. */
  datetime?: string;
}

export interface TimelineGroup {
  /** Stable grouping key (phone, or id fallback). */
  id: string;
  name: string;
  phone?: string;
  /** Optional mono pill (e.g. login code) shown in the header. */
  tag?: ReactNode;
  /** Right-aligned header summary (count + total + latest status). */
  summary?: ReactNode;
  /** Already sorted newest-first by the parent. */
  nodes: TimelineNode[];
}

function initialsOf(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function NodeRow({ n, connected }: { n: TimelineNode; connected: boolean }) {
  return (
    <div className={`relative ${connected ? "pb-4 last:pb-0" : ""}`}>
      {connected && (
        <span className={`absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${n.dot || "bg-ink2"}`} />
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{n.title}</p>
          {n.subtitle && <p className="mt-0.5 text-xs text-muted">{n.subtitle}</p>}
          {n.datetime && <p className="mt-0.5 text-[11px] text-muted">{formatISTDateTime(n.datetime)}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {n.right && <span className="text-sm font-semibold text-ink">{n.right}</span>}
          {n.badge}
        </div>
      </div>
    </div>
  );
}

/**
 * Shared premium collapsible "person card + timeline" used on Payments & Lead CRM.
 * Display-only: it groups already-prepared nodes — it never aggregates, dedupes or
 * drops anything. Single-node groups render compact (no timeline chrome); multi-
 * node groups collapse by default and reveal a connected, status-dotted timeline.
 * Animations are GPU-friendly (height/opacity) and respect prefers-reduced-motion.
 */
export default function GroupedTimeline({
  groups,
  forceOpenIds,
  emptyText = "Nothing to show.",
}: {
  groups: TimelineGroup[];
  forceOpenIds?: Set<string>;
  emptyText?: string;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!groups.length) {
    return <div className="card p-8 text-center text-sm text-muted">{emptyText}</div>;
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const single = g.nodes.length <= 1;
        const isOpen = single ? false : (open[g.id] ?? forceOpenIds?.has(g.id) ?? false);
        return (
          <div key={g.id} className="card overflow-hidden p-0">
            {/* Header — toggle for multi-node, static for single */}
            <div
              className={`flex items-center gap-3 p-4 ${single ? "" : "cursor-pointer select-none transition hover:bg-surface2"}`}
              onClick={single ? undefined : () => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}
              role={single ? undefined : "button"}
              tabIndex={single ? undefined : 0}
              onKeyDown={single ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => ({ ...o, [g.id]: !isOpen })); } }}
              aria-expanded={single ? undefined : isOpen}
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {initialsOf(g.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold text-ink">{g.name}</p>
                  {g.tag}
                </div>
                {g.phone && <p className="text-xs text-muted">{g.phone}</p>}
              </div>
              <div className="shrink-0 text-right">{g.summary}</div>
              {!single && (
                <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
              )}
            </div>

            {/* Body */}
            {single ? (
              <div className="border-t border-line px-4 pb-4 pt-3">
                <NodeRow n={g.nodes[0]} connected={false} />
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="body"
                    initial={reduce ? false : { height: 0, opacity: 0 }}
                    animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
                    exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-line px-4 pb-4 pt-4">
                      <div className="relative ml-2 border-l border-line pl-5">
                        {g.nodes.map((n) => (
                          <NodeRow key={n.id} n={n} connected />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        );
      })}
    </div>
  );
}
