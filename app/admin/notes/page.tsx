import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import NotesOrderQueue from "@/components/notes/admin/OrderQueue";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes orders" };

export default async function NotesOrdersPage() {
  if (!(await requirePermission("store_manage_orders"))) notFound();
  return <NotesOrderQueue />;
}
