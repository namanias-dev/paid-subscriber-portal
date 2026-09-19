import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import PreparationQueue from "@/components/notes/admin/PreparationQueue";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes preparation queue" };

export default async function NotesPreparationPage() {
  if (!(await requirePermission("store_manage_orders"))) notFound();
  return <PreparationQueue />;
}
