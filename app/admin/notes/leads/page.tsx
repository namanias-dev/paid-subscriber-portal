import { notFound } from "next/navigation";
import { requireStoreOrderRead } from "@/lib/adminGuard";
import CheckoutLeads from "@/components/notes/admin/CheckoutLeads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout leads" };

export default async function CheckoutLeadsPage() {
  if (!(await requireStoreOrderRead())) notFound();
  return <CheckoutLeads />;
}
