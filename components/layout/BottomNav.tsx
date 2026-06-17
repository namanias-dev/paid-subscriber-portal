"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Home", icon: "🏠", match: (p: string) => p === "/dashboard" },
  {
    href: "/dashboard/library",
    label: "Library",
    icon: "📚",
    match: (p: string) => p.startsWith("/dashboard/library"),
  },
  {
    href: "/dashboard#live",
    label: "Live",
    icon: "🔴",
    match: () => false,
  },
  {
    href: "/dashboard/bookmarks",
    label: "Saved",
    icon: "⭐",
    match: (p: string) => p.startsWith("/dashboard/bookmarks"),
  },
  {
    href: "/dashboard/profile",
    label: "Profile",
    icon: "👤",
    match: (p: string) => p.startsWith("/dashboard/profile"),
  },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex border-t md:hidden"
      style={{
        background: "rgba(10,22,40,0.96)",
        borderColor: "var(--border)",
        backdropFilter: "blur(12px)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.label}
            href={t.href}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2"
            style={{
              minHeight: 56,
              color: active ? "var(--gold-light)" : "var(--muted)",
            }}
          >
            <span className="text-lg">{t.icon}</span>
            <span className="text-[11px] font-medium">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
