"use client";

import { useRouter } from "next/navigation";

export default function PortalLogoutButton() {
  const router = useRouter();
  async function logout() {
    try {
      await fetch("/api/portal/logout", { method: "POST" });
    } finally {
      router.push("/portal/login");
      router.refresh();
    }
  }
  return (
    <button onClick={logout} className="btn btn-secondary text-sm">
      Log out
    </button>
  );
}
