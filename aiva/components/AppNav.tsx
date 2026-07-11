"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const NAV: { href: string; label: string; group: string }[] = [
  { href: "/aiva", label: "Command Center", group: "Overview" },
  { href: "/aiva/revenue", label: "Revenue Tower", group: "Agents" },
  { href: "/aiva/admissions", label: "Admissions", group: "Agents" },
  { href: "/aiva/marketing", label: "Marketing", group: "Agents" },
  { href: "/aiva/student-success", label: "Student Success", group: "Agents" },
  { href: "/aiva/content", label: "Content", group: "Agents" },
  { href: "/aiva/batch-launch", label: "Batch Launch", group: "Agents" },
  { href: "/aiva/analytics", label: "Analytics", group: "Agents" },
  { href: "/aiva/security", label: "Security", group: "Agents" },
  { href: "/aiva/approvals", label: "Approvals", group: "Control" },
  { href: "/aiva/actions", label: "Actions", group: "Control" },
  { href: "/aiva/learning", label: "Learning", group: "Control" },
  { href: "/aiva/codebase-intelligence", label: "Codebase Intelligence", group: "System" },
  { href: "/aiva/system-health", label: "System Health", group: "System" },
];

export default function AppNav({ name }: { name: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-navy-900/80 px-4 py-3 backdrop-blur md:hidden">
        <button className="aiva-btn-ghost !px-3 !py-1.5" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">☰</button>
        <span className="font-heading font-bold text-white">AIVA</span>
        <button className="aiva-btn-ghost !px-3 !py-1.5" onClick={logout}>Exit</button>
      </div>

      <aside
        className={`${open ? "block" : "hidden"} md:block md:sticky md:top-0 md:h-screen w-full md:w-64 shrink-0 border-r border-line bg-navy-900/60 p-4 md:overflow-y-auto`}
      >
        <div className="mb-4 hidden items-center gap-2 md:flex">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-gold-bright to-royal shadow-goldglow" />
          <div>
            <div className="font-heading font-extrabold leading-tight text-white">AIVA</div>
            <div className="text-[10px] uppercase tracking-wide text-muted">Command Center</div>
          </div>
        </div>
        <div className="mb-3 rounded-xl border border-line bg-navy-800/50 p-3 text-sm">
          <div className="text-muted">Signed in as</div>
          <div className="font-semibold text-white">{name}</div>
          <span className="aiva-chip mt-1 border-success/50 text-success">Read-only</span>
        </div>
        <nav className="space-y-4">
          {groups.map((g) => (
            <div key={g}>
              <div className="aiva-label mb-1">{g}</div>
              <ul className="space-y-0.5">
                {NAV.filter((n) => n.group === g).map((n) => {
                  const active = pathname === n.href;
                  return (
                    <li key={n.href}>
                      <Link
                        href={n.href}
                        onClick={() => setOpen(false)}
                        className={`block rounded-lg px-3 py-2 text-sm ${active ? "bg-royal/20 font-semibold text-white" : "text-ink hover:bg-navy-700/50"}`}
                      >
                        {n.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <button className="aiva-btn-ghost mt-4 hidden w-full md:inline-flex" onClick={logout}>Sign out</button>
      </aside>
    </>
  );
}
