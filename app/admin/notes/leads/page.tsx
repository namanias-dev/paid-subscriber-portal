import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import CheckoutLeads from "@/components/notes/admin/CheckoutLeads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout leads" };

export default async function CheckoutLeadsPage() {
  if (!(await requirePermission("store_manage_orders"))) notFound();
  return <CheckoutLeads />;
}
