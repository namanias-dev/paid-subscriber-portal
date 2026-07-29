"use client";

/**
 * Additive HISTORICAL legacy-lead pill. Never replaces SourcePill.
 * Renders nothing when there is no match — no empty pill, no layout shift.
 * Click opens the Leads Worklist (legacy scope, phone search) in a NEW TAB.
 */
import type { LegacyLeadMatch } from "@/lib/marketing/legacyLeadMatch";
import {
  formatLegacyDate,
  formatLegacyPillLabel,
  legacyWorklistHref,
} from "@/lib/marketing/legacyLeadMatch";

interface Props {
  match: LegacyLeadMatch | null;
  size?: "default" | "compact";
}

export default function LegacyLeadPill({ match, size = "default" }: Props) {
  if (!match) return null;
  const label = formatLegacyPillLabel(match);
  const date = formatLegacyDate(match.date);
  const title = [
    "Imported historical data — NOT current state.",
    `Legacy source tab: ${match.sourceTab || "—"}`,
    `Legacy campaign: ${match.campaign}`,
    `Legacy status: ${match.status}`,
    date ? `Legacy date: ${date}` : null,
    match.extraCount > 0 ? `${match.extraCount} older legacy row(s) on this phone` : null,
    "Click to open this person in the Leads Worklist (new tab).",
  ]
    .filter(Boolean)
    .join("\n");

  const padCls = size === "compact" ? "px-1.5 py-0" : "px-2 py-0.5";
  const textCls = size === "compact" ? "text-[10px]" : "text-[11px]";

  return (
    <a
      href={legacyWorklistHref(match.phoneKey)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex max-w-[280px] items-center truncate rounded-md border border-amber-300/80 bg-amber-50 font-medium text-amber-950 hover:bg-amber-100 ${padCls} ${textCls}`}
      title={title}
      aria-label={label}
    >
      {label}
    </a>
  );
}

export type { LegacyLeadMatch };
