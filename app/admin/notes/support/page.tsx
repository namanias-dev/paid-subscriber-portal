import { notFound } from "next/navigation";
import { requireStoreOrderRead } from "@/lib/adminGuard";
import SupportQueue from "@/components/notes/admin/SupportQueue";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes customer service" };

export default async function NotesSupportPage() {
  if (!(await requireStoreOrderRead())) notFound();
  return <SupportQueue />;
}
