import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import BuilderClient from "@/components/journey-automation/builder/BuilderClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journey Builder — Admin" };

// Gated by the SAME condition as the dashboard, nav and every workflow API:
// the `journey_view` permission. It is intentionally NOT gated on the execution
// master flag (the cron/engine gate) — that is an execution gate, not an authoring
// gate. Gating the builder on it made freshly-created drafts 404 while the (ungated)
// dashboard + create API happily produced them. Authoring a DRAFT never sends or
// executes anything.
export default async function JourneyBuilderPage({ params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_view"))) notFound();

  const [canEdit, canPublish, canPause, canCreate] = await Promise.all([
    requirePermission("journey_edit_draft"),
    requirePermission("journey_publish"),
    requirePermission("journey_pause"),
    requirePermission("journey_create_draft"),
  ]);

  return <BuilderClient workflowId={params.id} perms={{ canEdit, canPublish, canPause, canCreate }} />;
}
