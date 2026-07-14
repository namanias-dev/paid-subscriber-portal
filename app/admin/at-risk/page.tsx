import { redirect } from "next/navigation";

/**
 * Canonical "At-Risk Students" entry point. There is no combined data surface
 * (Payment Risk and Access Risk are two separate systems) — this parent simply
 * lands on the default tab (Payment Risk). Both underlying routes remain live
 * and are switchable via the AtRiskTabs strip. Navigation only.
 */
export default function AtRiskHub() {
  redirect("/admin/course-payments/at-risk");
}
