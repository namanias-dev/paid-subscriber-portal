"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ga4Event } from "@/lib/analytics/ga4";

/** Fires a monitorable not_found event once per mount. Never throws. */
export default function NotFoundTracker({
  path,
  reason = "not_found",
}: {
  path?: string;
  reason?: string;
}) {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const attempted = (path || pathname || "unknown").slice(0, 100);
      ga4Event("not_found", { attempted_path: attempted, reason: reason.slice(0, 40) }, { beacon: true });
    } catch {
      /* ignore */
    }
  }, [path, pathname, reason]);
  return null;
}
