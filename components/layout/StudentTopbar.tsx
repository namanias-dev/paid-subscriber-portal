"use client";

import Link from "next/link";
import Logo from "@/components/ui/Logo";
import { useDashboard } from "@/components/dashboard/DashboardContext";

export default function StudentTopbar() {
  const { student } = useDashboard();
  return (
    <header className="frost sticky top-0 z-30 border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2 lg:hidden">
          <Logo size={32} />
          <span className="font-heading text-sm font-extrabold">Naman IAS</span>
        </Link>
        <div className="hidden text-sm text-ink2 lg:block">
          {student ? `Welcome, ${student.name.split(" ")[0]}` : "Loading..."}
        </div>
        <div className="flex items-center gap-2">
          {student?.streak_count != null && (
            <span className="pill pill-amber">🔥 {student.streak_count}</span>
          )}
          <Link href="/dashboard/profile" className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-tint font-heading text-sm font-bold text-primary">
            {student?.name?.[0] ?? "S"}
          </Link>
        </div>
      </div>
    </header>
  );
}
