import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import NotesProductAdmin from "@/components/notes/admin/ProductAdmin";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes catalogue" };

export default async function NotesProductsPage() {
  if (!(await requirePermission("store_manage_catalogue"))) notFound();
  return <NotesProductAdmin />;
}
