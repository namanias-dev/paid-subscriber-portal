import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import JourneyOperate from "@/components/journey-automation/operate/JourneyOperate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journey Operations — Admin" };

/**
 * P5/P6 — Execution control, dry-run, runs/DLQ monitor, and analytics for one
 * workflow. Read-only + control surface; NO send path. Gated by `journey_view`
 * (consistent with the dashboard/builder); the execution-mode/canary controls
 * additionally require journey_manage_execution. NOT gated on the execution master
 * flag — that is an execution gate, not a viewing gate; viewing runs/analytics
 * never sends or executes anything.
 */
export default async function JourneyOperatePage({ params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_view"))) notFound();

  const [canManageExecution, canManageCategories] = await Promise.all([
    requirePermission("journey_manage_execution"),
    requirePermission("journey_manage_execution"),
  ]);

  return <JourneyOperate workflowId={params.id} perms={{ canManageExecution, canManageCategories }} />;
}
