import Link from "next/link";
import { formatPaise } from "@/lib/store/money";
import type { NotesAnalyticsView } from "@/lib/analytics/notesReport";
import type { NotesTrend } from "@/lib/analytics/notesVisuals";
import type { CheckoutLeadReport } from "@/lib/store/checkoutLeadLogic";
import CampaignLinkBuilder from "./CampaignLinkBuilder";
import Sparkline from "./analytics/Sparkline";
import SalesChartSlot from "./analytics/SalesChartSlot";
import CityRanking from "./analytics/CityRanking";

function money(paise: number): string {
  return formatPaise(paise);
}

function pct(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

const RANGES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["month", "This month"],
] as const;

const TONE: Record<NotesTrend["tone"], string> = {
  up: "text-[#3d6b4f]",
  down: "text-[#8a4b4b]",
  flat: "text-[var(--ca-navy)]/45",
  new: "text-[var(--ca-gold-dark)]",
  none: "text-[var(--ca-navy)]/35",
};

function trendSummary(name: string, trend: NotesTrend | undefined): string {
  if (!trend || trend.tone === "none") return `${name} trend`;
  if (trend.tone === "new") return `${name} trend, new versus the previous period`;
  return `${name} trend, ${trend.delta} versus the previous period`;
}

export default function NotesAnalytics({
  report,
  range,
  label,
  leads,
}: {
  report: NotesAnalyticsView;
  range: string;
  label: string;
  leads: CheckoutLeadReport;
}) {
  const k = report.kpis;
  const trends = report.visuals?.trends;
  const tiles: Array<{ label: string; value: string; trend?: NotesTrend }> = [
    { label: "Visitors", value: String(k.visitors), trend: trends?.visitors },
    { label: "Product viewers", value: String(k.productViewers), trend: trends?.productViewers },
    { label: "Add to cart", value: String(k.addToCarts), trend: trends?.addToCarts },
    { label: "Checkout", value: String(k.checkouts), trend: trends?.checkouts },
    { label: "Paid orders", value: String(k.paidOrders), trend: trends?.paidOrders },
    { label: "Conversion", value: pct(k.conversionPct), trend: trends?.conversion },
    { label: "Revenue", value: money(k.revenuePaise), trend: trends?.revenue },
    { label: "AOV", value: k.aovPaise == null ? "—" : money(k.aovPaise), trend: trends?.aov },
  ];
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Notes Store</p>
          <h1 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">Analytics</h1>
          <p className="mt-1 text-sm text-[var(--ca-navy)]/60">{label}. Sales metrics use captured orders. Behavior metrics use unique first-party sessions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map(([key, text]) => (
            <Link key={key} href={`/admin/notes/analytics?range=${key}`} className={`min-h-10 rounded-full px-3 py-2 text-sm font-semibold ${range === key ? "bg-[var(--ca-navy)] text-white" : "bg-white text-[var(--ca-navy)]"}`}>
              {text}
            </Link>
          ))}
          <form action="/admin/notes/analytics" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="range" value="custom" />
            <input type="date" name="from" aria-label="From" className="min-h-10 rounded-full border border-[var(--ca-navy)]/10 bg-white px-3 text-sm" />
            <input type="date" name="to" aria-label="To" className="min-h-10 rounded-full border border-[var(--ca-navy)]/10 bg-white px-3 text-sm" />
            <button type="submit" className={`min-h-10 rounded-full px-3 text-sm font-semibold ${range === "custom" ? "bg-[var(--ca-navy)] text-white" : "bg-white text-[var(--ca-navy)]"}`}>Custom</button>
          </form>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0 rounded-2xl bg-white px-3 py-3">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/45">{tile.label}</p>
            <p className="mt-1 font-heading text-xl font-bold tabular-nums text-[var(--ca-navy)]">{tile.value}</p>
            {tile.trend ? <Sparkline points={tile.trend.points} label={trendSummary(tile.label, tile.trend)} /> : null}
            {tile.trend ? (
              <p className={`mt-1 text-[10px] font-semibold tabular-nums ${TONE[tile.trend.tone]}`} title="Compared with the previous period">{tile.trend.delta}</p>
            ) : null}
          </div>
        ))}
      </div>

      {report.visuals ? (
        <SalesChartSlot points={report.visuals.points} grain={report.visuals.grain} subtitle={report.visuals.subtitle} />
      ) : (
        <section className="mt-4 rounded-2xl bg-white p-4">
          <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Sales over time</h2>
          <p className="mt-2 text-sm text-[var(--ca-navy)]/55">Sales timeline is unavailable right now.</p>
        </section>
      )}

      <section className="mt-4 rounded-2xl bg-white p-4">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Funnel</h2>
        <p className="mt-1 text-sm text-[var(--ca-navy)]/60">People are unique sessions. Paid is captured orders.</p>
        <ol className="mt-3 space-y-2">
          {report.funnel.map((step) => (
            <li key={step.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold text-[var(--ca-navy)]">{step.label}</span>
                <span className="tabular-nums text-[var(--ca-navy)]/70">
                  {step.people}
                  {step.fromPrevPct != null ? ` · ${step.fromPrevPct}% from previous` : ""}
                  {step.dropPct != null ? ` · drop ${step.dropPct}%` : ""}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-[var(--ca-navy)]/8">
                <div className="h-2 rounded-full bg-[var(--ca-navy)]" style={{ width: `${Math.max(4, report.funnel[0]?.people ? Math.round((step.people / report.funnel[0].people) * 100) : 0)}%` }} />
              </div>
            </li>
          ))}
        </ol>
        {report.largestDrop && (
          <p className="mt-3 text-sm font-medium text-[var(--ca-navy)]">Largest observed drop-off: {report.largestDrop.label} ({report.largestDrop.dropPct}%).</p>
        )}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <CityRanking cities={report.visuals ? report.visuals.cities : null} />
        <Table title="Acquisition" headers={["Source", "Visitors", "Checkout", "Paid", "Conv.", "Revenue"]} rows={report.sources.map((row) => [row.channel, row.visitors, row.checkouts, row.paid, pct(row.conversionPct), money(row.revenuePaise)])} />
      </div>

      <div className="mt-4">
        <Table title="Campaigns" headers={["Campaign", "Content", "Visitors", "Paid", "Revenue"]} rows={report.campaigns.map((row) => [row.campaign, row.content, row.visitors, row.paid, money(row.revenuePaise)])} />
      </div>

      <div className="mt-4">
        <Table title="Products" headers={["Product", "Views", "PDF", "Video", "Cart", "Orders", "Conv.", "Revenue"]} rows={report.products.map((row) => [row.label, row.views, row.pdfPeople, row.videoStarts, row.addToCarts, row.orders, pct(row.conversionPct), money(row.revenuePaise)])} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-4">
          <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Content</h2>
          <ul className="mt-3 space-y-1 text-sm text-[var(--ca-navy)]">
            <li>PDF sample opens: {report.content.pdfPeople} people</li>
            <li>Video starts: {report.content.videoStarts} people</li>
            <li>Video 50%: {report.content.video50} people</li>
            <li>Video completes: {report.content.videoCompletes} people</li>
            <li>Polity card: {report.subjects.polity.clicks} clicks · {report.subjects.polity.people} people</li>
            <li>Economy card: {report.subjects.economy.clicks} clicks · {report.subjects.economy.people} people</li>
          </ul>
        </section>
        <section className="rounded-2xl bg-white p-4">
          <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Checkout health</h2>
          <ul className="mt-3 space-y-1 text-sm text-[var(--ca-navy)]">
            <li>Checkout starts: {report.checkoutHealth.starts}</li>
            <li>Payment attempts: {report.checkoutHealth.paymentAttempts}</li>
            <li>Paid: {report.checkoutHealth.paid}</li>
            <li>Payment failures: {report.checkoutHealth.failedPayments}</li>
            <li>Validation errors: {report.checkoutHealth.validationErrors}</li>
            <li>Shipping quote failures: {report.checkoutHealth.shippingErrors}</li>
            <li>API errors: {report.checkoutHealth.apiErrors}</li>
          </ul>
          {report.checkoutHealth.topErrors.length > 0 && (
            <p className="mt-2 text-sm text-[var(--ca-navy)]/70">Most common: {report.checkoutHealth.topErrors.map((row) => `${row.key} (${row.count})`).join(", ")}</p>
          )}
          {report.checkoutHealth.browsers.length > 0 && (
            <p className="mt-1 text-sm text-[var(--ca-navy)]/70">Browsers on errors: {report.checkoutHealth.browsers.map((row) => `${row.browser} ${row.errors}`).join(", ")}</p>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Table title="Landing pages" headers={["Page", "Sessions", "Clicks", "Checkout", "Paid"]} rows={report.landings.slice(0, 12).map((row) => [row.path, row.sessions, row.productClicks, row.checkouts, row.purchases])} />
        <Table title="Devices" headers={["Device", "Sessions", "Checkouts", "Paid"]} rows={report.devices.map((row) => [row.device, row.sessions, row.checkouts, row.purchases])} />
      </div>

      {report.promotions.some((row) => row.code !== "(none)") && (
        <div className="mt-4">
          <Table title="Promotions" headers={["Code", "Orders", "Revenue"]} rows={report.promotions.filter((row) => row.code !== "(none)").map((row) => [row.code, row.orders, money(row.revenuePaise)])} />
        </div>
      )}

      {report.ctas.length > 0 && (
        <div className="mt-4">
          <Table title="CTAs" headers={["CTA", "Events", "People"]} rows={report.ctas.map((row) => [row.id, row.events, row.people])} />
        </div>
      )}

      <section className="mt-4 rounded-2xl bg-white p-4">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Checkout leads</h2>
        <p className="mt-1 text-sm text-[var(--ca-navy)]/55">Separate from the purchase funnel above. QA leads are excluded.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ["Leads", String(leads.leads)],
            ["Abandoned", String(leads.abandoned)],
            ["Recovered", String(leads.recovered)],
            ["Lead → paid", pct(leads.leadToPaidPct)],
            ["Recovered revenue", money(leads.recoveredRevenuePaise)],
          ].map(([labelText, value]) => (
            <div key={labelText}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ca-navy)]/45">{labelText}</p>
              <p className="mt-1 font-heading text-xl font-bold text-[var(--ca-navy)]">{value}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="mt-4">
        <Table title="Lead sources" headers={["Source", "Leads", "Abandoned", "Recovered", "Paid", "Recovered revenue"]} rows={leads.sources.map((row) => [row.source, row.leads, row.abandoned, row.recovered, row.paid, money(row.revenuePaise)])} />
      </div>
      <div className="mt-4">
        <CampaignLinkBuilder />
      </div>
      {report.excludedTestEvents > 0 && (
        <p className="mt-3 text-xs text-[var(--ca-navy)]/45">{report.excludedTestEvents} QA events were excluded from these numbers.</p>
      )}
    </div>
  );
}

function Table({ title, headers, rows }: { title: string; headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white">
      <h2 className="px-4 pt-4 font-heading text-lg font-bold text-[var(--ca-navy)]">{title}</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-[var(--ca-navy)]/45">
              {headers.map((header) => <th key={header} className="px-4 py-2 font-semibold">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="px-4 py-4 text-[var(--ca-navy)]/50" colSpan={headers.length}>No data in this range yet.</td></tr>
            ) : rows.map((row, index) => (
              <tr key={index} className="border-t border-[var(--ca-navy)]/5">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-2 text-[var(--ca-navy)]">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
