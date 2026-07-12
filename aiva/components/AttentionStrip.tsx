"use client";

import { useState } from "react";
import { useApi, Card, SectionTitle, SeverityPill, Skeleton } from "@/components/kit";
import { useDrill } from "@/components/drill/DrillProvider";
import OpenInPortal from "@/components/portal/OpenInPortal";
import type { PortalLink } from "@/lib/portal/links";

type Flag = {
  id: string;
  severity: string;
  domain: string;
  title: string;
  why: string;
  calc: string;
  drill?: string;
  links: PortalLink[];
};

/** BUILD 3 — ranked, explainable "what needs my attention" strip at the top of the Command Center. */
export default function AttentionStrip() {
  const { data, loading, error } = useApi<{ flags: Flag[] }>("/api/attention");
  const { openDrill } = useDrill();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Card>
      <SectionTitle sub="Ranked by urgency. Each flag shows the exact math, the records behind it, and a one-click jump into the portal. Read-only — buttons only navigate.">
        What needs your attention
      </SectionTitle>

      {loading ? (
        <Skeleton lines={3} />
      ) : error ? (
        <p className="text-sm text-danger">Could not load: {error}</p>
      ) : (
        <ul className="space-y-2">
          {(data?.flags || []).map((f) => {
            const expanded = open === f.id;
            return (
              <li key={f.id} className={`aiva-flag ${sevBox(f.severity)}`}>
                <button
                  type="button"
                  className="aiva-flag-head"
                  onClick={() => setOpen(expanded ? null : f.id)}
                  aria-expanded={expanded}
                >
                  <SeverityPill severity={f.severity} />
                  <span className="aiva-flag-title">{f.title}</span>
                  <span className="aiva-flag-chevron" aria-hidden>{expanded ? "▾" : "▸"}</span>
                </button>

                {expanded ? (
                  <div className="aiva-flag-body">
                    <p className="text-sm text-ink">{f.why}</p>
                    <div className="aiva-flag-calc">{f.calc}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {f.drill ? (
                        <button
                          type="button"
                          className="aiva-btn-ghost px-3 py-1.5 text-xs"
                          onClick={() => openDrill({ domain: f.domain, metric: f.drill!, label: f.title })}
                        >
                          See the records ↗
                        </button>
                      ) : (
                        <span className="text-xs text-muted">Records for this flag live in the portal →</span>
                      )}
                      <OpenInPortal links={f.links} size="xs" />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function sevBox(sev: string): string {
  if (sev === "high") return "aiva-flag-high";
  if (sev === "medium") return "aiva-flag-medium";
  return "aiva-flag-low";
}
