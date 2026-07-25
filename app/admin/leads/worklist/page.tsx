import { Suspense } from "react";
import LeadWorklistClient from "@/components/admin/leadWorklist/LeadWorklistClient";
import { getAdminSession } from "@/lib/session";
import { requireSuperAdmin } from "@/lib/adminGuard";

/**
 * PHASE 2 — the lead worklist.
 *
 * A thin server shell whose only job is to resolve WHO is signed in, so the
 * "My Queue" segment can filter on a real identity instead of asking the
 * browser to guess. That identity is the same string `getActionActor()` writes
 * into `leads.assigned_to`, which is what makes the segment actually match.
 *
 * Reading it here avoids adding another `/api/admin/me`-shaped round trip on a
 * page that already has a heavy first request to make.
 *
 * PERMISSION: the data is gated at the API (`manage_students_leads`, enforced
 * inside every worklist route), and the nav entry is gated by the same key. A
 * user without it who types the URL gets a page whose every request answers
 * 401 and whose table renders that as a visible, honest error.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Lead Worklist — Admin" };

export default async function LeadWorklistPage() {
  const [session, isSuperAdmin] = await Promise.all([
    getAdminSession(),
    // Phase 4: decides only whether the promotion control is RENDERED. The
    // action is gated independently by `requireSuperAdmin` inside the route,
    // so a forged prop buys nothing.
    requireSuperAdmin(),
  ]);

  return (
    <Suspense fallback={<div className="skeleton h-96 w-full animate-shimmer" />}>
      <LeadWorklistClient
        currentAdmin={session?.username ?? null}
        isSuperAdmin={isSuperAdmin}
      />
    </Suspense>
  );
}
