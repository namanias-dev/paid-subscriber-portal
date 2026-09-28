import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";
import InterestDashboard from "@/components/notes/admin/InterestDashboard";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes demand" };

export default async function NotesInterestPage() {
  if (!(await requireSuperAdmin())) notFound();
  return <InterestDashboard />;
}
