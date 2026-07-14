import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import { journeyAutomationEnabled } from "@/lib/journey-automation/flags";
import BuilderClient from "@/components/journey-automation/builder/BuilderClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journey Builder — Admin" };

export default async function JourneyBuilderPage({ params }: { params: { id: string } }) {
  if (!journeyAutomationEnabled()) notFound();
  if (!(await requirePermission("journey_view"))) notFound();

  const [canEdit, canPublish, canPause, canCreate] = await Promise.all([
    requirePermission("journey_edit_draft"),
    requirePermission("journey_publish"),
    requirePermission("journey_pause"),
    requirePermission("journey_create_draft"),
  ]);

  return <BuilderClient workflowId={params.id} perms={{ canEdit, canPublish, canPause, canCreate }} />;
}
