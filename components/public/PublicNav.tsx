"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/ui/Logo";
import { ACADEMY } from "@/lib/config";

const LINKS = [
  { href: "/courses", label: "Courses" },
  { href: "/results", label: "Results" },
  { href: "/webinars", label: "Webinars" },
  { href: "/free-resources", label: "Free Resources" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function PublicNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="frost sticky top-0 z-50 border-b border-line">
      <div className="container-wide flex items-center justify-between py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={38} />
          <div className="leading-tight">
            <div className="font-heading text-[17px] font-extrabold text-ink">{ACADEMY.shortName}</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted">Academy</div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-surface"
                style={{ color: active ? "var(--primary)" : "var(--ink2)" }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/login" className="btn btn-ghost px-3">Login</Link>
          <Link href="/demo" className="btn btn-primary px-4">Book Free Demo</Link>
        </div>

        <button
          aria-label="Menu"
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-line p-2 lg:hidden"
        >
          <div className="space-y-1">
            <span className="block h-0.5 w-5 bg-ink" />
            <span className="block h-0.5 w-5 bg-ink" />
            <span className="block h-0.5 w-5 bg-ink" />
          </div>
        </button>
      </div>

      {open && (
        <div className="border-t border-line bg-white lg:hidden">
          <div className="container-wide flex flex-col gap-1 py-3">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink2 hover:bg-surface"
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-2 flex gap-2">
              <Link href="/login" onClick={() => setOpen(false)} className="btn btn-secondary flex-1">Login</Link>
              <Link href="/demo" onClick={() => setOpen(false)} className="btn btn-primary flex-1">Free Demo</Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
