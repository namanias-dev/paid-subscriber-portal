"use client";

import { requestLogout } from "@/lib/welcome";

export default function LogoutButton({ className = "btn btn-ghost w-full justify-start" }: { className?: string }) {
  return (
    <button onClick={() => requestLogout("/api/auth/logout", "/login")} className={className}>
      ↩ Logout
    </button>
  );
}
