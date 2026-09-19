import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import NotesOverview from "@/components/notes/admin/Overview";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes Store overview" };

export default async function NotesOverviewPage() {
  if (!(await requirePermission("store_manage_orders"))) notFound();
  return <NotesOverview />;
}
