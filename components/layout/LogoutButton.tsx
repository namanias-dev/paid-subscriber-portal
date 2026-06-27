"use client";

export default function LogoutButton({ className = "btn btn-ghost w-full justify-start" }: { className?: string }) {
  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    // Hard navigation: fully drops the client router cache (no stale auth state).
    window.location.replace("/login");
  }
  return (
    <button onClick={logout} className={className}>
      ↩ Logout
    </button>
  );
}
