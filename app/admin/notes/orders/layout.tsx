import { notFound } from "next/navigation";
import { requireStoreOrderRead } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

/** Order detail lives under this segment. Read access is required; mutations are enforced on each API. */
export default async function NotesOrderDetailLayout({ children }: { children: React.ReactNode }) {
  if (!(await requireStoreOrderRead())) notFound();
  return children;
}
