import { notFound } from "next/navigation";
import { requireFreshSuperAdmin } from "@/lib/adminGuard";
import NotesOverview from "@/components/notes/admin/Overview";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes Store overview" };

export default async function NotesOverviewPage() {
  if (!(await requireFreshSuperAdmin())) notFound();
  return <NotesOverview />;
}
