"use client";

import { useMemo, useState } from "react";
import CourseCard from "@/components/public/CourseCard";
import FilterTabs from "@/components/ui/FilterTabs";
import { COURSE_CATEGORIES } from "@/lib/config";
import type { Course } from "@/lib/types";

export default function CourseExplorer({ courses, limit }: { courses: Course[]; limit?: number }) {
  const [cat, setCat] = useState("all");
  const tabs = [{ id: "all", label: "All" }, ...COURSE_CATEGORIES.map((c) => ({ id: c, label: c }))];

  const filtered = useMemo(() => {
    const list = cat === "all" ? courses : courses.filter((c) => c.category === cat);
    return limit ? list.slice(0, limit) : list;
  }, [courses, cat, limit]);

  return (
    <div>
      <FilterTabs options={tabs} active={cat} onChange={setCat} />
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>
    </div>
  );
}
