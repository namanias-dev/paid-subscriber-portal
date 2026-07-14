"use client";

import Link from "next/link";

/**
 * Unified "People" hub tab strip. Purely navigational/labeling — it links to the
 * EXISTING People routes (no page rewrites, no route moves) and shows a one-line
 * lens + persona affordance so Ops / Finance / Collections know which screen to use.
 * Each page passes its own `active` key (no hooks) so it is safe to render inside
 * any statically-shelled admin page.
 */
export type PeopleTabKey = "students" | "fees" | "risk" | "access";

interface Tab {
  key: PeopleTabKey;
  label: string;
  href: string;
  purpose: string;
}

const TABS: Tab[] = [
  { key: "students", label: "Students", href: "/admin/students", purpose: "Operational lens · Find & manage a person — for front-desk / Ops" },
  { key: "fees", label: "Fees & EMI", href: "/admin/course-payments", purpose: "Financial & capacity lens · Cohort revenue & seats — for Finance / CFO" },
  { key: "risk", label: "Fees at Risk", href: "/admin/course-payments/at-risk", purpose: "Collections lens · Overdue EMIs to chase — for Collections / CEO" },
  { key: "access", label: "Access at Risk", href: "/admin/access-risk", purpose: "Access lens · Expiring or blocked lecture access — for Ops" },
];

const SECONDARY = [
  { label: "Payments & Finance", href: "/admin/payments" },
  { label: "Duplicate Enrollments", href: "/admin/enrollments/duplicates" },
];

export default function PeopleTabs({ active }: { active: PeopleTabKey }) {
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
        <span className="ml-auto hidden items-center gap-3 pr-1 text-xs text-muted md:flex">
          {SECONDARY.map((s) => (
            <Link key={s.href} href={s.href} className="hover:text-primary">{s.label}</Link>
          ))}
        </span>
      </div>
      {activeTab && <p className="mt-2 px-1 text-xs text-muted">{activeTab.purpose}</p>}
    </div>
  );
}
