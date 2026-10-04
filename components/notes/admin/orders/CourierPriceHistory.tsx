"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { formatPaise } from "@/lib/store/money";
import { formatAdminWhen, providerDisplayName } from "@/lib/store/adminConsole";
import { formatPackageWeight } from "@/lib/store/orderOpsDisplay";

interface Attempt {
  id: string;
  quote_option_id: string;
  status: "BOOKING" | "BOOKED" | "CITY_CONFIRM" | "FAILED" | "BLOCKED";
  failure_category?: string | null;
  selected_by_name?: string | null;
  created_at: string;
  completed_at?: string | null;
  awb?: string | null;
}

interface Option {
  id: string;
  position: number;
  provider: string;
  courier_name: string;
  service_name: string | null;
  transport_mode: string | null;
  quoted_rate_paise: number;
  eta_days: number | null;
  eta_text: string | null;
  eligible: boolean;
  eligibility_reason: string | null;
  is_cheapest_eligible: boolean;
  attempts: Attempt[];
}

interface SessionView {
  number: number;
  outcome: "BOOKED" | "AWAITING_CITY_CONFIRMATION" | "BOOKING" | "FAILED" | "NOT_SELECTED" | "EXPIRED";
  session: {
    id: string;
    created_at: string;
    created_by_name?: string | null;
    package_weight_grams: number;
    package_length_mm: number;
    package_width_mm: number;
    package_height_mm: number;
    destination_city?: string | null;
    destination_state?: string | null;
    destination_pincode: string;
    total_quote_count: number;
    provider_outcomes?: Array<{ provider: string; ok: boolean; configured: boolean; error: string | null }>;
  };
  options: Option[];
  booked: { option: Option; attempt: Attempt } | null;
  cheapest: Option[];
  premiumPaise: number | null;
  premiumPct: number | null;
}

interface HistoryResponse {
  ok: boolean;
  error?: string;
  history_started: string;
  sessions: SessionView[];
  current_shipment: { courier: string | null; provider: string | null; awb: string | null; booked_rate_paise: number | null } | null;
}

const OUTCOME: Record<SessionView["outcome"], string> = {
  BOOKED: "Booked",
  AWAITING_CITY_CONFIRMATION: "Awaiting courier city confirmation",
  BOOKING: "Booking in progress",
  FAILED: "Booking not completed",
  NOT_SELECTED: "No courier selected",
  EXPIRED: "Rates expired · no courier selected",
};

const FAILURE: Record<string, string> = {
  ADDRESS_CONFIRMATION_FAILED: "courier address confirmation",
  DUPLICATE_SHIPMENT_BLOCK: "an active shipment already exists",
  PROVIDER_CREATE_FAILED: "the courier did not create the shipment",
  PROVIDER_CREATE_FAILED_CANCELLED: "the courier shipment was cancelled",
  PICKUP_PENDING: "pickup was not requested",
  RATE_EXPIRED: "rates had expired",
  PACKAGE_OR_ADDRESS_CHANGED: "package or address changed after comparison",
  QUOTE_NOT_ELIGIBLE: "option was not eligible",
  CITY_CONFIRMATION_DECLINED: "courier city was declined",
};

function day(iso: string): string {
  return formatAdminWhen(iso) || iso;
}

function packageLine(s: SessionView["session"]): string {
  const cm = (mm: number) => {
    const v = mm / 10;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  };
  return `${formatPackageWeight(s.package_weight_grams)} · ${cm(s.package_length_mm)}×${cm(s.package_width_mm)}×${cm(s.package_height_mm)} cm`;
}

function destinationLine(s: SessionView["session"]): string {
  return [[s.destination_city, s.destination_state].filter(Boolean).join(", "), s.destination_pincode].filter(Boolean).join(" · ");
}

function eta(o: Option): string {
  if (o.eta_text) return o.eta_text;
  return o.eta_days != null ? `${o.eta_days}d` : "—";
}

function attemptLine(a: Attempt): string {
  if (a.status === "BOOKED") return "Selected · Booked";
  if (a.status === "CITY_CONFIRM") return "Selected · Awaiting city confirmation";
  if (a.status === "BOOKING") return "Selected · Booking";
  const why = a.failure_category ? FAILURE[a.failure_category] || a.failure_category.replaceAll("_", " ").toLowerCase() : null;
  if (a.status === "BLOCKED") return `Not booked${why ? ` — ${why}` : ""}`;
  return `Selected · Booking failed${why ? ` — ${why}` : ""}`;
}

function premiumText(view: SessionView): string | null {
  if (view.premiumPaise == null) return null;
  if (view.premiumPaise <= 0) return "Cheapest option selected";
  return `+${formatPaise(view.premiumPaise)}${view.premiumPct != null ? ` · ${view.premiumPct}% above cheapest` : ""}`;
}

function OptionStatus({ option }: { option: Option }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {option.is_cheapest_eligible && <span className="rounded-full bg-[#fce9a8]/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ca-gold-dark)]">Cheapest</span>}
      {!option.eligible && <span className="text-xs text-ca-navy/50">{option.eligibility_reason || "Unavailable"}</span>}
      {option.attempts.map((a) => (
        <span
          key={a.id}
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${a.status === "BOOKED" ? "bg-[var(--ca-navy)] text-white" : "bg-ca-navy/[0.06] text-ca-navy/70"}`}
        >
          {a.status === "BOOKED" ? "✓ " : ""}
          {attemptLine(a)}
        </span>
      ))}
    </span>
  );
}

function SessionCard({ view, open, onToggle }: { view: SessionView; open: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();
  const failed = (view.session.provider_outcomes || []).filter((p) => p.configured && !p.ok);
  return (
    <li className="rounded-xl border border-ca-navy/[0.08] bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2 text-left">
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-ca-navy/50">Courier comparison #{view.number}</span>
          <span className="block text-sm font-semibold text-[var(--ca-navy)]">{day(view.session.created_at)}</span>
          <span className="block text-xs text-ca-navy/55">
            {view.session.total_quote_count} {view.session.total_quote_count === 1 ? "option" : "options"} · {OUTCOME[view.outcome]}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-ca-navy/50">{open ? "Hide" : "View all quotes"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-ca-navy/[0.06] px-3 pb-3 pt-2">
              <p className="text-xs text-ca-navy/60">
                Package {packageLine(view.session)} · {destinationLine(view.session)}
                {view.session.created_by_name ? ` · compared by ${view.session.created_by_name}` : ""}
              </p>
              {failed.length > 0 && (
                <p className="mt-1 text-xs text-ca-navy/60">
                  {failed.map((p) => `${providerDisplayName(p.provider)}: no rates returned${p.error === "TIMEOUT" ? " (timed out)" : ""}`).join(" · ")}
                </p>
              )}
              {view.options.length === 0 ? (
                <p className="mt-2 text-sm text-ca-navy/60">No courier rate was returned in this comparison.</p>
              ) : (
                <>
                  <table className="mt-2 hidden w-full text-left text-sm md:table">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-ca-navy/45">
                        {["Courier", "Provider", "Mode", "Quote", "ETA", "Status"].map((h) => <th key={h} className="py-1.5 pr-3 font-semibold">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {view.options.map((o) => {
                        const booked = o.attempts.some((a) => a.status === "BOOKED");
                        return (
                          <tr key={o.id} className={`border-t border-ca-navy/[0.05] align-top ${booked ? "bg-[#fbf8f3]" : ""}`}>
                            <td className="py-2 pr-3 font-semibold text-[var(--ca-navy)]">{o.courier_name}</td>
                            <td className="py-2 pr-3 text-ca-navy/70">{providerDisplayName(o.provider)}</td>
                            <td className="py-2 pr-3 text-ca-navy/70">{o.transport_mode || o.service_name || "—"}</td>
                            <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-[var(--ca-navy)]">{formatPaise(o.quoted_rate_paise)}</td>
                            <td className="py-2 pr-3 text-ca-navy/70">{eta(o)}</td>
                            <td className="py-2"><OptionStatus option={o} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <ol className="mt-2 space-y-2 md:hidden">
                    {view.options.map((o) => {
                      const booked = o.attempts.some((a) => a.status === "BOOKED");
                      return (
                        <li key={o.id} className={`rounded-lg px-2 py-2 ${booked ? "bg-[#fbf8f3]" : "bg-ca-navy/[0.02]"}`}>
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="min-w-0 font-semibold text-[var(--ca-navy)]">{o.courier_name}</p>
                            <p className="shrink-0 tabular-nums text-[var(--ca-navy)]">{formatPaise(o.quoted_rate_paise)}</p>
                          </div>
                          <p className="text-xs text-ca-navy/55">{providerDisplayName(o.provider)} · {o.transport_mode || o.service_name || "—"} · ETA {eta(o)}</p>
                          <div className="mt-1"><OptionStatus option={o} /></div>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** Read-only courier price history for one order. Nothing here books or changes a shipment. */
export default function CourierPriceHistory({ orderId, reloadKey = "" }: { orderId: string; reloadKey?: string | number }) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setFailed(false);
    fetch(`/api/admin/notes/orders/${orderId}/courier-history`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: HistoryResponse) => {
        if (!live) return;
        if (!json.ok) return setFailed(true);
        setData(json);
        setOpenId(json.sessions[0]?.session.id || null);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [orderId, reloadKey]);

  if (failed) {
    return (
      <section className="rounded-2xl bg-white p-4">
        <h2 className="font-heading text-lg font-bold text-[var(--ca-navy)]">Courier price history</h2>
        <p className="mt-2 text-sm text-ca-navy/60">Courier price history is unavailable right now.</p>
      </section>
    );
  }
  if (!data) return null;
  const decision = data.sessions.find((v) => v.booked) || null;
  const ship = data.current_shipment;
  if (!data.sessions.length && !ship) return null;
  const started = new Date(`${data.history_started}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

  return (
    <section className="rounded-2xl bg-white p-4" aria-labelledby={`courier-history-${orderId}`}>
      <h2 id={`courier-history-${orderId}`} className="font-heading text-lg font-bold text-[var(--ca-navy)]">Courier price history</h2>

      {decision ? (
        <div className="mt-3 rounded-xl bg-[#fbf8f3] px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Courier decision</p>
          <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ca-navy/50">Selected</dt>
              <dd className="font-semibold text-[var(--ca-navy)]">{decision.booked!.option.courier_name} · {formatPaise(decision.booked!.option.quoted_rate_paise)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ca-navy/50">Cheapest available</dt>
              <dd className="text-[var(--ca-navy)]">{decision.cheapest.length ? `${decision.cheapest.map((o) => o.courier_name).join(" / ")} · ${formatPaise(decision.cheapest[0].quoted_rate_paise)}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ca-navy/50">Price difference from cheapest</dt>
              <dd className="tabular-nums text-[var(--ca-navy)]">{premiumText(decision) || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ca-navy/50">Options compared</dt>
              <dd className="text-[var(--ca-navy)]">{decision.session.total_quote_count}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ca-navy/50">Selected by</dt>
              <dd className="text-[var(--ca-navy)]">{decision.booked!.attempt.selected_by_name || "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-ca-navy/50">Compared · Booked</dt>
              <dd className="text-[var(--ca-navy)]">{day(decision.session.created_at)} · {day(decision.booked!.attempt.completed_at || decision.booked!.attempt.created_at)}</dd>
            </div>
          </dl>
        </div>
      ) : !data.sessions.length && ship ? (
        <div className="mt-3 rounded-xl bg-[#fbf8f3] px-3 py-3 text-sm text-[var(--ca-navy)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">Selected courier</p>
          <p className="mt-1 font-semibold">
            {ship.courier || providerDisplayName(ship.provider || "")}
            {ship.booked_rate_paise ? ` · ${formatPaise(ship.booked_rate_paise)}` : ""}
          </p>
          <p className="mt-1 text-ca-navy/60">Historical quote list unavailable — quote history was not recorded at the time. Recording began {started}.</p>
        </div>
      ) : null}

      {data.sessions.length > 0 && (
        <ol className="mt-3 space-y-2">
          {data.sessions.map((view) => (
            <SessionCard key={view.session.id} view={view} open={openId === view.session.id} onToggle={() => setOpenId((cur) => (cur === view.session.id ? null : view.session.id))} />
          ))}
        </ol>
      )}
    </section>
  );
}
