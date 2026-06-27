"use client";

export default function PortalLogoutButton() {
  async function logout() {
    try {
      await fetch("/api/portal/logout", { method: "POST" });
    } finally {
      // Hard navigation: fully drops the in-memory router cache so no stale
      // "logged in / registered" RSC payload survives the logout.
      window.location.replace("/portal/login");
    }
  }
  return (
    <button onClick={logout} className="btn btn-secondary text-sm">
      Log out
    </button>
  );
}
