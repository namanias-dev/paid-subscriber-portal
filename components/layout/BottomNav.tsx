"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AppIcon from "@/components/ui/AppIcon";
import { STUDENT_BOTTOM_NAV } from "./navItems";

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="frost fixed inset-x-0 bottom-0 z-40 border-t border-line lg:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-between px-2 py-1.5">
        {STUDENT_BOTTOM_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition"
              style={{ color: active ? "var(--primary)" : "var(--muted)" }}
            >
              <AppIcon name={item.icon} size={20} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
