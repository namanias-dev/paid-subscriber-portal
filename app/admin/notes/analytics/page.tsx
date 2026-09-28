import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/adminGuard";
import NotesAnalytics from "@/components/notes/admin/NotesAnalytics";
import { loadNotesAnalytics } from "@/lib/analytics/notesReport";
import { loadCheckoutLeadReport } from "@/lib/store/checkoutLeads";
import { notesRangeBounds, type NotesRangeKey } from "@/lib/analytics/notesCommerce";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const metadata = { title: "Notes Store analytics" };

const KEYS = new Set(["today", "yesterday", "7d", "30d", "month", "custom"]);

export default async function NotesAnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string; code?: string };
}) {
  if (!(await requireSuperAdmin())) notFound();
  const key = (KEYS.has(searchParams.range || "") ? searchParams.range : "7d") as NotesRangeKey;
  const bounds = notesRangeBounds(key, new Date(), { from: searchParams.from, to: searchParams.to });
  const report = await loadNotesAnalytics({ key, from: searchParams.from, to: searchParams.to });
  const leads = await loadCheckoutLeadReport(bounds.start, bounds.end);
  const highlightCode = (searchParams.code || "").trim().toUpperCase();
  return <NotesAnalytics report={report} range={key} label={bounds.label} leads={leads} highlightCode={highlightCode} />;
}
