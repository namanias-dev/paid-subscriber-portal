import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import { journeyAutomationEnabled } from "@/lib/journey-automation/flags";
import JourneyOperate from "@/components/journey-automation/operate/JourneyOperate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journey Operations — Admin" };

/**
 * P5/P6 — Execution control, dry-run, runs/DLQ monitor, and analytics for one
 * workflow. Read-only + control surface; NO send path. Permission-gated; the
 * execution-mode/canary controls additionally require journey_manage_execution.
 */
export default async function JourneyOperatePage({ params }: { params: { id: string } }) {
  if (!journeyAutomationEnabled()) notFound();
  if (!(await requirePermission("journey_view"))) notFound();

  const [canManageExecution, canManageCategories] = await Promise.all([
    requirePermission("journey_manage_execution"),
    requirePermission("journey_manage_execution"),
  ]);

  return <JourneyOperate workflowId={params.id} perms={{ canManageExecution, canManageCategories }} />;
}
