"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/ui/Logo";
import AppIcon from "@/components/ui/AppIcon";
import LogoutButton from "./LogoutButton";
import { STUDENT_NAV } from "./navItems";

export default function StudentSidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-white lg:flex">
      <Link href="/dashboard" className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <Logo size={36} />
        <div className="leading-tight">
          <div className="font-heading text-base font-extrabold">Naman IAS</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted">Student</div>
        </div>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {STUDENT_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition"
              style={{
                background: active ? "var(--primary-tint)" : "transparent",
                color: active ? "var(--primary)" : "var(--ink2)",
              }}
            >
              <AppIcon name={item.icon} size={19} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-3">
        <LogoutButton />
      </div>
    </aside>
  );
}
