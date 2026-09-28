"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isEnrollmentCheckoutPath } from "@/lib/enrollmentPath";

/** Drops the public footer on enrollment checkout so it cannot sit under the payment bar. */
export default function EnrollmentFooterGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isEnrollmentCheckoutPath(pathname)) return null;
  return children;
}
