"use client";

import Link from "next/link";

/**
 * "Students & Enrollments" sub-tab strip. Purely navigational/labeling — it
 * links to the EXISTING routes (no page rewrites, no route moves, no duplicated
 * fetch) and shows a one-line Operational-lens persona affordance. Each page
 * passes its own `active` key (no hooks) so it is safe to render inside any
 * statically-shelled admin page.
 *
 * The Duplicate-Enrollments tool folds in here as its own accurately-labeled
 * "Duplicate Enrollments" tab (its primary sidebar entry was removed); the
 * underlying route stays fully live.
 */
export type PeopleTabKey = "students" | "duplicates";

interface Tab {
  key: PeopleTabKey;
  label: string;
  href: string;
  purpose: string;
}

const TABS: Tab[] = [
  {
    key: "students",
    label: "All Students",
    href: "/admin/students",
    purpose: "Operational lens · Find & manage a person — identity, contact, enrollments & access",
  },
  {
    key: "duplicates",
    label: "Duplicate Enrollments",
    href: "/admin/enrollments/duplicates",
    purpose: "Operational lens · Review & de-duplicate repeat course enrollments (payment history is always preserved)",
  },
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
      </div>
      {activeTab && <p className="mt-2 px-1 text-xs text-muted">{activeTab.purpose}</p>}
    </div>
  );
}
