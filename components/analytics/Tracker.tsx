"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ensureVisitorId, ensureSession, captureAttribution, trackClient } from "@/lib/analytics/client";

/**
 * Mounted once in the root layout. On first load it provisions the visitor id,
 * captures first/last-touch attribution, and opens a session; on every client
 * navigation it emits a page_view. First-party essential analytics run under
 * legitimate interest (independent of the 3rd-party marketing consent gate).
 */
export default function Tracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const prevPath = useRef<string | null>(null);
  const prevAt = useRef<number>(Date.now());

  useEffect(() => {
    ensureVisitorId();
    captureAttribution();
    const s = ensureSession();
    if (s?.isNew) {
      trackClient("session_start", {
        entry_path: window.location.pathname,
        is_new_visitor: !document.referrer || !document.referrer.includes(location.hostname),
        utm_present: /utm_/.test(window.location.search),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const path = pathname + (search?.toString() ? `?${search.toString()}` : "");
    if (prevPath.current === path) return;
    const now = Date.now();
    trackClient("page_view", {
      title: typeof document !== "undefined" ? document.title : "",
      path,
      query_params: search?.toString() || "",
      time_on_prev_page_ms: prevPath.current ? now - prevAt.current : 0,
    });
    prevPath.current = path;
    prevAt.current = now;
  }, [pathname, search]);

  return null;
}
