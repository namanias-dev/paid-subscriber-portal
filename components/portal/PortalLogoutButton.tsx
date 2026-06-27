"use client";

import { requestLogout } from "@/lib/welcome";

export default function PortalLogoutButton() {
  return (
    <button onClick={() => requestLogout("/api/portal/logout", "/portal/login")} className="btn btn-secondary text-sm">
      Log out
    </button>
  );
}
