"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton({ className = "btn btn-ghost w-full justify-start" }: { className?: string }) {
  const router = useRouter();
  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.push("/login");
    router.refresh();
  }
  return (
    <button onClick={logout} className={className}>
      ↩ Logout
    </button>
  );
}
