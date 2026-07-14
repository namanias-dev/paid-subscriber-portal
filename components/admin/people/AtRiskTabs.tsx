"use client";

import Link from "next/link";

/**
 * "At-Risk Students" sub-tab strip. Presents the two SEPARATE existing risk
 * systems as distinct tabs without fusing their data/queries/logic:
 *   • Payment Risk  → overdue course-fee EMIs  (/admin/course-payments/at-risk)
 *   • Access Risk   → expiring/blocked lecture access (/admin/access-risk)
 *
 * Purely navigational — links to the EXISTING pages (each keeps its own data,
 * permissions & child page title). Each page passes its own `active` key.
 */
export type AtRiskTabKey = "payment" | "access";

interface Tab {
  key: AtRiskTabKey;
  label: string;
  href: string;
  purpose: string;
}

const TABS: Tab[] = [
  {
    key: "payment",
    label: "Payment Risk",
    href: "/admin/course-payments/at-risk",
    purpose: "Collections lens · Overdue course-fee EMIs to chase — for Collections / CEO",
  },
  {
    key: "access",
    label: "Access Risk",
    href: "/admin/access-risk",
    purpose: "Access lens · Expiring or blocked lecture access — for Ops (NOT fee overdue)",
  },
];

export default function AtRiskTabs({ active }: { active: AtRiskTabKey }) {
  const activeTab = TABS.find((t) => t.key === active);
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${
                on ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink2"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {activeTab && <p className="mt-2 px-1 text-xs text-muted">{activeTab.purpose}</p>}
    </div>
  );
}
