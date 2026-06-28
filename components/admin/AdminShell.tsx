"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/ui/Logo";
import AdminLogin from "./AdminLogin";
import AdminPasswordModal from "./AdminPasswordModal";
import { ADMIN_NAV } from "./adminNav";
import { UploadManagerProvider } from "./upload/uploadManager";
import UploadManagerWidget from "./upload/UploadManagerWidget";
import HelpPanel from "./help/HelpPanel";
import { allPermissions, type PermissionSet } from "@/lib/permissions";

interface AdminMe { username: string; role: string; role_name?: string; permissions?: PermissionSet; must_change_password?: boolean }

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [pwOpen, setPwOpen] = useState(false);

  async function check() {
    try {
      const res = await fetch("/api/admin/me");
      const data = await res.json();
      setAuthed(data.ok);
      setAdmin(data.admin || null);
    } catch {
      setAuthed(false);
    }
  }

  useEffect(() => {
    check();
  }, []);

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthed(false);
  }

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="skeleton h-10 w-40 animate-shimmer" />
      </div>
    );
  }

  if (!authed) return <AdminLogin onSuccess={() => check()} />;

  // Legacy tokens (pre-RBAC) carry no permissions field — treat them as full access.
  const perms = admin?.permissions === undefined ? allPermissions() : admin.permissions;
  // Super Admin (and any account whose role grants it) sees everything; otherwise gate by permission.
  const visibleNav = ADMIN_NAV.filter((n) => !n.perm || perms[n.perm] === true);
  const groups = Array.from(new Set(visibleNav.map((n) => n.group)));

  const SidebarContent = (
    <>
      <Link href="/admin" className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <Logo size={34} variant="admin" />
        <div className="leading-tight">
          <div className="font-heading text-sm font-extrabold">Admin Panel</div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Naman IAS</div>
        </div>
      </Link>
      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {groups.map((g) => (
          <div key={g}>
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{g}</p>
            <div className="space-y-0.5">
              {visibleNav.filter((n) => n.group === g).map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition"
                    style={{
                      background: active ? "var(--primary-tint)" : "transparent",
                      color: active ? "var(--primary)" : "var(--ink2)",
                    }}
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button onClick={logout} className="btn btn-ghost m-3 justify-start">↩ Logout</button>
    </>
  );

  return (
    <UploadManagerProvider>
    <div className="min-h-screen bg-surface">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-white lg:flex">
        {SidebarContent}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white">{SidebarContent}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="frost sticky top-0 z-30 flex items-center justify-between border-b border-line px-4 py-3">
          <button onClick={() => setOpen(true)} className="rounded-lg border border-line p-2 lg:hidden">☰</button>
          <div className="hidden text-sm text-ink2 lg:block">UPSC Edtech Control Center</div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-ink2 hover:text-primary">View site ↗</Link>
            <button onClick={() => setPwOpen(true)} className="text-sm text-ink2 hover:text-primary">Password</button>
            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-ink2 sm:block">{admin?.username}</span>
              <span className="pill pill-blue">{admin?.role_name || admin?.role || "Admin"}</span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">
          {admin?.must_change_password && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--warning)] bg-[#fef3e2] px-4 py-3 text-sm text-[#8a5a00]">
              <span>For security, please change your temporary password.</span>
              <button onClick={() => setPwOpen(true)} className="btn btn-primary text-xs">Change password</button>
            </div>
          )}
          {children}
        </main>
      </div>

      <AdminPasswordModal open={pwOpen} onClose={() => setPwOpen(false)} onChanged={() => { setPwOpen(false); check(); }} />
      <UploadManagerWidget />
      <HelpPanel />
    </div>
    </UploadManagerProvider>
  );
}
