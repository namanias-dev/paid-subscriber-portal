import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import NotesOffersAdmin from "@/components/notes/admin/OffersAdmin";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes offers" };

export default async function NotesOffersPage() {
  if (!(await requirePermission("store_manage_catalogue"))) notFound();
  return <NotesOffersAdmin />;
}
