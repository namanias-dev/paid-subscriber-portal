import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import DiscountCodesAdmin from "@/components/notes/admin/DiscountCodesAdmin";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Discount codes" };

export default async function NotesDiscountsPage() {
  if (!(await requirePermission("store_manage_catalogue"))) notFound();
  return <DiscountCodesAdmin />;
}
