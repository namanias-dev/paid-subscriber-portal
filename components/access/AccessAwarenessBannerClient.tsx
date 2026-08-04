"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AccessAwarenessBanner, { type AccessAwarenessBanner as Banner } from "./AccessAwarenessBanner";

/**
 * Fetches access-awareness banner for dashboard / mobile shells.
 * On Class Hub routes, scopes to that course; otherwise shows the most urgent enrollment.
 */
export default function AccessAwarenessBannerClient({
  courseId: courseIdProp,
  compact = true,
  className,
}: {
  courseId?: string;
  compact?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const hubMatch = pathname.match(/^\/dashboard\/class\/([^/]+)/);
  const courseId = courseIdProp || hubMatch?.[1];
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    const q = courseId ? `?courseId=${encodeURIComponent(courseId)}` : "";
    fetch(`/api/student/access-awareness${q}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d?.ok && d.banner) setBanner(d.banner as Banner); })
      .catch(() => {});
  }, [courseId]);

  if (!banner) return null;
  return <AccessAwarenessBanner banner={banner} compact={compact} className={className} />;
}
