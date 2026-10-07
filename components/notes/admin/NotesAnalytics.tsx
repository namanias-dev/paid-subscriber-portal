import Link from "next/link";
import { formatPaise } from "@/lib/store/money";
import type { NotesAnalyticsView } from "@/lib/analytics/notesReport";
import type { NotesTrend } from "@/lib/analytics/notesVisuals";
import type { CheckoutLeadReport } from "@/lib/store/checkoutLeadLogic";
import type { NotesIntel } from "@/lib/analytics/notesIntel";
import CampaignLinkBuilder from "./CampaignLinkBuilder";
import Sparkline from "./analytics/Sparkline";
import SalesChartSlot from "./analytics/SalesChartSlot";
import CityRanking from "./analytics/CityRanking";
import AnalyticsShell from "./analytics/AnalyticsShell";
import SubjectPerformance from "./analytics/SubjectPerformance";
import GeoIntel from "./analytics/GeoIntel";
import ShippingIntel from "./analytics/ShippingIntel";
import FulfillmentMethods from "./analytics/FulfillmentMethods";
import { kpiTiles } from "./analytics/kpiTiles";

function money(paise: number): string {
  return formatPaise(paise);
}

function pct(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

const TONE: Record<NotesTrend["tone"], string> = {
  up: "text-[#3d6b4f]",
  down: "text-[#8a4b4b]",
  flat: "text-ca-navy/45",
  new: "text-[var(--ca-gold-dark)]",
  none: "text-ca-navy/35",
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
  intel,
}: {
  report: NotesAnalyticsView;
  range: string;
  label: string;
  leads: CheckoutLeadReport;
  intel: NotesIntel | null;
}) {
  const tiles = kpiTiles(report, intel);
  return (
    <div className="mx-auto max-w-6xl">
      <AnalyticsShell
        range={range}
        header={
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Notes Store</p>
            <h1 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">Analytics</h1>
            <p className="mt-1 text-sm text-ca-navy/60">{label}. Sales metrics use captured orders. Behavior metrics use unique first-party sessions. Times are IST.</p>
          </div>
        }
      >
      {/* Two columns on phones, three on tablets, five on desktop. No horizontal rail. */}
      <div data-kpi-grid className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div
            key={tile.id}
            data-kpi={tile.id}
            role="group"
            aria-label={tile.ariaLabel}
            className={`flex min-w-0 flex-col rounded-2xl bg-white px-3.5 py-3 ${tile.wide ? "col-span-2 sm:col-span-1 lg:col-span-2" : ""}`}
            title={tile.id === "avgShipping" ? BOOKED_RATE_NOTE : undefined}
          >
            <p className="text-[11px] font-semibold uppercase leading-snug tracking-wide text-ca-navy/45">{tile.label}</p>
            {/* Plain text, no transform or clipping: the business number must always be legible. */}
            <p
              data-kpi-value
              className={`mt-1 whitespace-nowrap font-heading font-bold leading-[1.2] tabular-nums text-[var(--ca-navy)] ${tile.value.length >= 10 ? "text-[19px] sm:text-xl" : "text-[22px] sm:text-2xl"}`}
            >
              {tile.value}
            </p>
            {tile.trend ? <Sparkline points={tile.trend.points} label={trendSummary(tile.label, tile.trend)} /> : null}
            {tile.trend ? (
              <p data-kpi-delta className={`mt-auto pt-1 text-[11px] font-semibold tabular-nums ${TONE[tile.trend.tone]}`} title="Compared with the previous period">{tile.trend.delta}</p>
            ) : null}
            {tile.note ? <p data-kpi-delta className="mt-auto pt-1 text-[11px] tabular-nums text-ca-navy/50">{tile.note}</p> : null}
          </div>
        ))}
      </div>

      <CommerceStrip intel={intel} />

      <FulfillmentMethods intel={intel} />

      <SubjectPerformance subjects={intel ? intel.subjects : null} totalMerchandisePaise={intel ? intel.cohort.merchandisePaise : null} />

      {report.visuals ? (
        <SalesChartSlot points={report.visuals.points} fulfillment={intel ? intel.fulfillment : null} grain={report.visuals.grain} subtitle={report.visuals.subtitle} />
      ) : (
        <section className="mt-4 rounded-2xl bg-white p-4">
          <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Sales over time</h2>
          <p className="mt-2 text-sm text-ca-navy/55">Sales timeline is unavailable right now.</p>
        </section>
      )}

      <section className="mt-4 rounded-2xl bg-white p-4">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Funnel</h2>
        <p className="mt-1 text-sm text-ca-navy/60">People are unique sessions. Paid is captured orders.</p>
        <ol className="mt-3 space-y-2">
          {report.funnel.map((step) => (
            <li key={step.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold text-[var(--ca-navy)]">{step.label}</span>
                <span className="tabular-nums text-ca-navy/70">
                  {step.people}
                  {step.fromPrevPct != null ? ` · ${step.fromPrevPct}% from previous` : ""}
                  {step.dropPct != null ? ` · drop ${step.dropPct}%` : ""}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-ca-navy/8">
                <div className="h-2 rounded-full bg-[var(--ca-navy)]" style={{ width: `${Math.max(4, report.funnel[0]?.people ? Math.round((step.people / report.funnel[0].people) * 100) : 0)}%` }} />
              </div>
            </li>
          ))}
        </ol>
        {report.largestDrop && (
          <p className="mt-3 text-sm font-medium text-[var(--ca-navy)]">Largest observed drop-off: {report.largestDrop.label} ({report.largestDrop.dropPct}%).</p>
        )}
      </section>

      {intel ? (
        <GeoIntel states={intel.states} cities={intel.cities} />
      ) : (
        <div className="mt-4 space-y-2">
          <p className="rounded-2xl bg-white px-4 py-3 text-sm text-ca-navy/55">Geographic and shipping intelligence are unavailable right now. Sales, funnel and city totals below are unaffected.</p>
          <CityRanking cities={report.visuals ? report.visuals.cities : null} />
        </div>
      )}

      {intel ? <ShippingIntel shipping={intel.shipping} anomalies={intel.anomalies} rule={intel.anomalyRule} /> : null}

      <div className="mt-4">
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
            <p className="mt-2 text-sm text-ca-navy/70">Most common: {report.checkoutHealth.topErrors.map((row) => `${row.key} (${row.count})`).join(", ")}</p>
          )}
          {report.checkoutHealth.browsers.length > 0 && (
            <p className="mt-1 text-sm text-ca-navy/70">Browsers on errors: {report.checkoutHealth.browsers.map((row) => `${row.browser} ${row.errors}`).join(", ")}</p>
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
        <p className="mt-1 text-sm text-ca-navy/55">Separate from the purchase funnel above. QA leads are excluded.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          {[
            ["Leads", String(leads.leads)],
            ["Abandoned", String(leads.abandoned)],
            ["Recovered", String(leads.recovered)],
            ["Lead → paid", pct(leads.leadToPaidPct)],
            ["Recovered revenue", money(leads.recoveredRevenuePaise)],
          ].map(([labelText, value]) => (
            <div key={labelText}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ca-navy/45">{labelText}</p>
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
      {report.eventsCapped ? (
        <p className="mt-3 text-xs font-semibold text-[#8a4b4b]">This range has more behaviour events than the dashboard reads at once. Visitor and funnel numbers are partial; choose a shorter range. Sales numbers are complete.</p>
      ) : null}
      {report.excludedTestEvents > 0 && (
        <p className="mt-3 text-xs text-ca-navy/45">{report.excludedTestEvents} QA events were excluded from these numbers.</p>
      )}
      </AnalyticsShell>
    </div>
  );
}

const NOW_LINKS: Array<{ key: "packed" | "pickup" | "inTransit" | "outForDelivery"; label: string; href: string }> = [
  { key: "packed", label: "Packed", href: "/admin/notes?status=packed" },
  { key: "pickup", label: "Courier pickup", href: "/admin/notes?status=pickup" },
  { key: "inTransit", label: "In transit", href: "/admin/notes?status=shipped" },
  { key: "outForDelivery", label: "Out for delivery", href: "/admin/notes?status=shipped" },
];

const BOOKED_RATE_NOTE = "Booked courier rate saved when the courier was booked, for orders paid in this range. Provider invoice charge may differ. Customer shipping charged at checkout is not used.";

/** Secondary strip: range shipping economics, current fulfillment, and today's events. */
function CommerceStrip({ intel }: { intel: NotesIntel | null }) {
  if (!intel) {
    return (
      <section className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm text-ca-navy/55">
        Commerce and fulfillment summary is unavailable right now.
      </section>
    );
  }
  const ship = intel.shipping;
  const label = "text-[10px] font-semibold uppercase tracking-[0.14em] text-ca-navy/45";
  return (
    <section className="mt-3 rounded-2xl bg-white/70 p-3 ring-1 ring-ca-navy/[0.05]" aria-label="Commerce and fulfillment">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">Commerce &amp; fulfillment</p>
      <div className="mt-2 grid gap-2 lg:grid-cols-12">
        <div className="rounded-xl bg-white px-3 py-2 lg:col-span-3" title={BOOKED_RATE_NOTE}>
          <p className={label}>Booked shipping</p>
          {ship.avgPaise == null ? (
            <p className="mt-1 text-[12px] text-ca-navy/55">No booked rates in this range.</p>
          ) : (
            <dl className="mt-1 grid grid-cols-3 gap-1 text-[var(--ca-navy)]">
              {([
                ["Avg", ship.avgPaise],
                ["Min", ship.minPaise],
                ["Max", ship.maxPaise],
              ] as const).map(([text, value]) => (
                <div key={text} className="min-w-0">
                  <dt className="text-[11px] text-ca-navy/55">{text}</dt>
                  <dd className="whitespace-nowrap font-heading text-[15px] font-bold leading-[1.25] tabular-nums">{value == null ? "—" : money(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-1 text-[11px] tabular-nums text-ca-navy/45">Rate on {ship.count} of {ship.booked} booked · orders paid in range</p>
        </div>
        <div className="rounded-xl bg-white px-3 py-2 lg:col-span-5">
          <p className={label}>Current fulfillment</p>
          <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
            {NOW_LINKS.map((item) => (
              <Link key={item.key} href={item.href} className="ca-focus min-w-0 rounded-lg px-1 py-1 hover:bg-ca-navy/[0.03]">
                <span className="block font-heading text-xl font-bold tabular-nums text-[var(--ca-navy)]">{intel.now[item.key]}</span>
                <span className="block truncate text-[11px] text-ca-navy/55">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-white px-3 py-2 lg:col-span-4">
          <p className={label}>Today · IST</p>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {([
              ["Picked up by courier", intel.today.pickedUp],
              ["Shipped", intel.today.shipped],
              ["Delivered", intel.today.delivered],
            ] as const).map(([text, value]) => (
              <div key={text} className="min-w-0 px-1 py-1">
                <span className="block font-heading text-xl font-bold tabular-nums text-[var(--ca-navy)]">{value}</span>
                <span className="block truncate text-[11px] text-ca-navy/55">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Table({ title, headers, rows }: { title: string; headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white">
      <h2 className="px-4 pt-4 font-heading text-lg font-bold text-[var(--ca-navy)]">{title}</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ca-navy/45">
              {headers.map((header) => <th key={header} className="px-4 py-2 font-semibold">{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="px-4 py-4 text-ca-navy/50" colSpan={headers.length}>No data in this range yet.</td></tr>
            ) : rows.map((row, index) => (
              <tr key={index} className="border-t border-ca-navy/5">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-2 text-[var(--ca-navy)]">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
