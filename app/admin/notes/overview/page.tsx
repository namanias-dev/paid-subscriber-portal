import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";
import NotesOverview from "@/components/notes/admin/Overview";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes Store overview" };

export default async function NotesOverviewPage() {
  if (!(await requireSuperAdmin())) notFound();
  return <NotesOverview />;
}
