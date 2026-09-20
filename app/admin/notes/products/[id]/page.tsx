import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import ProductEditor from "@/components/notes/admin/ProductEditor";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Manage notes product" };

export default async function NotesProductEditorPage({ params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_catalogue"))) notFound();
  return <ProductEditor id={params.id} />;
}
