"use client";

import Link from "next/link";

/**
 * Unified "People" hub tab strip. Purely navigational/labeling — it links to the
 * EXISTING People routes (no page rewrites, no route moves) and shows a one-line
 * lens + persona affordance so Ops / Finance / Collections know which screen to use.
 * Each page passes its own `active` key (no hooks) so it is safe to render inside
 * any statically-shelled admin page.
 *
 * PRIMARY tabs = the four approved People lenses (Students · Enrollments ·
 * Fees & EMI · Fees at Risk). SECONDARY links keep every other People destination
 * reachable without cluttering the four-lens hub, and disambiguate the two
 * "at risk" views (fee collections vs. lecture access).
 */
export type PeopleTabKey =
  | "students"
  | "enrollments"
  | "fees"
  | "risk"
  | "access"
  | "payments";

interface HubItem {
  key: PeopleTabKey;
  label: string;
  href: string;
  purpose: string;
}

const PRIMARY: HubItem[] = [
  {
    key: "students",
    label: "Students",
    href: "/admin/students",
    purpose: "Operational lens · Find & manage a person — for front-desk / Ops",
  },
  {
    key: "enrollments",
    label: "Enrollments",
    href: "/admin/enrollments/duplicates",
    purpose: "Operational lens · Review & de-duplicate course enrollments — for Ops",
  },
  {
    key: "fees",
    label: "Fees & EMI",
    href: "/admin/course-payments",
    purpose: "Financial & capacity lens · Cohort revenue & seats — for Finance / CFO",
  },
  {
    key: "risk",
    label: "Fees at Risk",
    href: "/admin/course-payments/at-risk",
    purpose: "Collections lens · Overdue course-fee EMIs to chase — for Collections / CEO",
  },
];

const SECONDARY: HubItem[] = [
  {
    key: "access",
    label: "Access at Risk (lectures)",
    href: "/admin/access-risk",
    purpose: "Access lens · Expiring or blocked lecture access — for Ops (NOT fee overdue)",
  },
  {
    key: "payments",
    label: "Payments & Finance",
    href: "/admin/payments",
    purpose: "Ledger lens · All payment receipts across products — for Finance",
  },
];

export default function PeopleTabs({ active }: { active: PeopleTabKey }) {
  const activeItem = [...PRIMARY, ...SECONDARY].find((t) => t.key === active);
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-1 border-b border-line">
        {PRIMARY.map((t) => {
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
        <span className="ml-auto hidden items-center gap-3 pr-1 text-xs md:flex">
          {SECONDARY.map((s) => {
            const on = s.key === active;
            return (
              <Link
                key={s.key}
                href={s.href}
                aria-current={on ? "page" : undefined}
                className={on ? "font-semibold text-primary" : "text-muted hover:text-primary"}
              >
                {s.label}
              </Link>
            );
          })}
        </span>
      </div>
      {activeItem && <p className="mt-2 px-1 text-xs text-muted">{activeItem.purpose}</p>}
    </div>
  );
}
