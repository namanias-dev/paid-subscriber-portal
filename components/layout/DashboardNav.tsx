"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/ui/Logo";
import { useToast } from "@/components/ui/Toast";

const LINKS = [
  { href: "/dashboard", label: "Home" },
  { href: "/dashboard/library", label: "Library" },
  { href: "/dashboard/bookmarks", label: "Saved" },
  { href: "/dashboard/profile", label: "Profile" },
];

export default function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    toast("Logged out", "success");
    router.replace("/");
  }

  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{ background: "rgba(10,22,40,0.92)", borderColor: "var(--border)", backdropFilter: "blur(12px)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Logo size={36} />
          <div className="leading-tight">
            <div className="font-heading text-lg text-text">Naman IAS</div>
            <div className="text-[10px] uppercase tracking-widest text-muted">
              Subscriber Portal
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active =
              l.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-lg px-3 py-2 text-sm font-medium transition"
                style={{
                  color: active ? "var(--gold-light)" : "var(--muted)",
                  background: active ? "rgba(201,168,76,0.1)" : "transparent",
                }}
              >
                {l.label}
              </Link>
            );
          })}
          <button onClick={logout} className="btn-outline ml-2 px-3 py-1.5 text-sm">
            Logout
          </button>
        </nav>

        <button
          onClick={logout}
          className="btn-outline px-3 py-1.5 text-xs md:hidden"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
