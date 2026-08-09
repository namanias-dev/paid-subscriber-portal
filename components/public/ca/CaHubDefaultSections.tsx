"use client";

import { useSearchParams } from "next/navigation";

/** Hides default hub sections while URL filters are active. */
export default function CaHubDefaultSections({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams();
  const filtering = !!(sp.get("type") || sp.get("gs") || sp.get("rel") || (sp.get("q") || "").trim());
  if (filtering) return null;
  return <>{children}</>;
}
