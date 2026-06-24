"use client";

import { useMemo, useState } from "react";
import { GraduationCap } from "lucide-react";
import CourseCard from "@/components/public/CourseCard";
import { COURSE_CATEGORIES } from "@/lib/config";
import type { Course } from "@/lib/types";
import type { CoursePurchaseView } from "@/lib/purchaseStatus";

export default function CourseExplorer({ courses, limit, purchaseMap }: { courses: Course[]; limit?: number; purchaseMap?: Record<string, CoursePurchaseView> }) {
  const [cat, setCat] = useState("all");
  // Only show category chips that actually have published courses (keeps the bar clean).
  const present = new Set(courses.map((c) => c.category));
  const tabs = [{ id: "all", label: "All" }, ...COURSE_CATEGORIES.filter((c) => present.has(c as Course["category"])).map((c) => ({ id: c, label: c }))];

  const filtered = useMemo(() => {
    const list = cat === "all" ? courses : courses.filter((c) => c.category === cat);
    return limit ? list.slice(0, limit) : list;
  }, [courses, cat, limit]);

  return (
    <div>
      {/* Premium segmented filter */}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
        {tabs.map((opt) => {
          const active = opt.id === cat;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setCat(opt.id)}
              aria-pressed={active}
              className={`ca-focus inline-flex min-h-[44px] shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-all duration-200 motion-reduce:transition-none ${
                active
                  ? "bg-gradient-to-r from-[var(--ca-gold-bright)] to-[var(--ca-gold)] text-[#1a1304] shadow-[0_8px_20px_-8px_rgba(212,175,55,0.6)]"
                  : "border border-[var(--ca-slate-200)] bg-white text-[var(--ca-slate-700)] hover:border-[rgba(212,175,55,0.6)] hover:text-[var(--ca-navy-900)]"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="mx-auto mt-8 max-w-md rounded-2xl border border-[var(--ca-slate-200)] bg-white p-10 text-center shadow-soft">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ca-slate-50)] text-[var(--ca-slate-400)]">
            <GraduationCap size={22} aria-hidden="true" />
          </span>
          <p className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">No courses in this category yet</p>
          <p className="mt-1 text-sm text-[var(--ca-slate-700)]">New programs are added regularly — check back soon.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CourseCard key={c.id} course={c} purchase={purchaseMap?.[c.slug] ?? null} />
          ))}
        </div>
      )}
    </div>
  );
}
