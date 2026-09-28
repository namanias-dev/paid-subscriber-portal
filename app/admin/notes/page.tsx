import { notFound } from "next/navigation";
import { requireStoreOrderRead } from "@/lib/adminGuard";
import NotesOrderQueue from "@/components/notes/admin/OrderQueue";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes orders" };

export default async function NotesOrdersPage() {
  if (!(await requireStoreOrderRead())) notFound();
  return <NotesOrderQueue />;
}
