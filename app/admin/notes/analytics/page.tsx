import { notFound } from "next/navigation";
import { requireFreshSuperAdmin } from "@/lib/adminGuard";
import NotesAnalytics from "@/components/notes/admin/NotesAnalytics";
import { loadNotesAnalytics } from "@/lib/analytics/notesReport";
import { loadNotesIntel } from "@/lib/analytics/notesIntelLoad";
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
  if (!(await requireFreshSuperAdmin())) notFound();
  const key = (KEYS.has(searchParams.range || "") ? searchParams.range : "7d") as NotesRangeKey;
  const now = new Date();
  const bounds = notesRangeBounds(key, now, { from: searchParams.from, to: searchParams.to });
  const highlightCode = (searchParams.code || "").trim().toUpperCase();
  // Independent loads: intelligence failing returns null and leaves KPIs, sales and funnel intact.
  const [report, leads, intel] = await Promise.all([
    loadNotesAnalytics({ key, from: searchParams.from, to: searchParams.to, now }),
    loadCheckoutLeadReport(bounds.start, bounds.end),
    loadNotesIntel({ key, from: searchParams.from, to: searchParams.to, now }),
  ]);
  return <NotesAnalytics report={report} range={key} label={bounds.label} leads={leads} intel={intel} highlightCode={highlightCode} />;
}
