import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import DiscountCodeDetail from "@/components/notes/admin/DiscountCodeDetail";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Discount code" };

export default async function NotesDiscountDetailPage({ params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_catalogue"))) notFound();
  return <DiscountCodeDetail id={params.id} />;
}
