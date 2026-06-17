"use client";

import Link from "next/link";
import { SUBJECTS } from "@/lib/config";

export default function SubjectChips() {
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {SUBJECTS.map((s) => (
        <Link
          key={s}
          href={`/dashboard/library?subject=${encodeURIComponent(s)}`}
          className="whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium text-muted transition hover:text-gold-light"
          style={{ minHeight: 40, borderColor: "var(--border)" }}
        >
          {s}
        </Link>
      ))}
    </div>
  );
}
