/**
 * Courier quote history: every Compare Couriers result is saved as shown, bookings
 * reference a saved option only, and every attempt is kept. Uses the in-memory
 * fixture database. No courier provider is called.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localFixtureClient } from "../../lib/store/localFixture";
import type { ProviderRateResult } from "../../lib/store/shipping/quotes";
import {
  QUOTE_TTL_MS,
  bookingFailureCategory,
  bookingFingerprint,
  checkSelection,
  findSessionByRequestKey,
  finishAttempt,
  historySummaries,
  loadHistory,
  persistQuoteSession,
  premiumPercent,
  presentedOptions,
  sessionInsert,
  sessionViews,
  startAttempt,
  transportMode,
  type QuoteOptionRow,
  type QuoteSessionRow,
} from "../../lib/store/shipping/quoteHistory";
import { PREMIUM_NOTICE_PAISE, selectionPremiumNotice } from "../../lib/store/adminConsole";
import { opsLines, quoteHistoryLine, type OrderOps } from "../../lib/store/orderOpsDisplay";

const db = localFixtureClient() as unknown as SupabaseClient;
const PACK = { weightGrams: 500, lengthCm: 30, widthCm: 25, heightCm: 3, source: "PRODUCT_PROFILE" };
const ADDRESS = { line1: "12 Test Lane", line2: "", city: "Ranchi", state: "Jharkhand", pincode: "834008" };
const STAFF = { id: "abhishek", name: "abhishek" };

function quote(provider: "shiprocket" | "delhivery", courier: string, rupees: number, extra: Partial<ProviderRateResult["quotes"][number]> = {}) {
  return { provider, courier, service: /air/i.test(courier) ? "Air" : "Surface", ratePaise: Math.round(rupees * 100), etaDays: null, etaText: null, codSupported: false, prepaid: true, ...extra };
}

function providers(...quotes: ReturnType<typeof quote>[]): ProviderRateResult[] {
  return (["delhivery", "shiprocket"] as const).map((provider) => ({
    provider,
    configured: true,
    ok: quotes.some((q) => q.provider === provider),
    quotes: quotes.filter((q) => q.provider === provider),
    error: quotes.some((q) => q.provider === provider) ? null : "timeout while fetching rates",
  }));
}

let orderSeq = 0;
async function compare(results: ProviderRateResult[], opts: { orderId?: string; now?: Date; requestKey?: string | null; pack?: typeof PACK; address?: typeof ADDRESS } = {}) {
  const orderId = opts.orderId || `00000000-0000-4000-9000-${String(++orderSeq).padStart(12, "0")}`;
  const presented = presentedOptions(results);
  const saved = await persistQuoteSession(
    db,
    sessionInsert({
      orderId,
      requestKey: opts.requestKey ?? null,
      actor: STAFF,
      pack: opts.pack || PACK,
      destination: { city: (opts.address || ADDRESS).city, state: (opts.address || ADDRESS).state, pincode: (opts.address || ADDRESS).pincode },
      fingerprint: bookingFingerprint(opts.pack || PACK, opts.address || ADDRESS),
      presented,
      providers: results,
      now: opts.now || new Date(),
    }),
    presented,
  );
  assert.ok(saved, "session saved");
  return { orderId, presented, ...saved! };
}

const byName = (options: QuoteOptionRow[], name: string) => options.find((o) => o.courier_name === name)!;

async function book(session: QuoteSessionRow, option: QuoteOptionRow, outcome: "BOOKED" | "FAILED", extra: { category?: string; awb?: string } = {}) {
  const attempt = await startAttempt(db, { session, option, actor: STAFF });
  assert.ok(attempt);
  await finishAttempt(db, attempt!.id, { status: outcome, category: extra.category || null, awb: extra.awb || null, shipmentId: outcome === "BOOKED" ? crypto.randomUUID() : null });
  return attempt!;
}

async function views(orderId: string, now = new Date()) {
  const history = await loadHistory(db, orderId);
  assert.ok(history);
  return sessionViews(history!.sessions, history!.options, history!.attempts, now);
}

describe("capture (spec 2–8, 43–45)", () => {
  it("saves one session with the exact rows, order and cheapest flag staff see", async () => {
    const { session, options, presented } = await compare(providers(quote("shiprocket", "Xpressbees Surface", 93.72, { etaDays: 4 }), quote("delhivery", "Delhivery Surface", 65.98), quote("shiprocket", "Ekart Surface", 98.72, { etaText: "5 days" })));
    assert.equal(options.length, 3);
    assert.deepEqual(options.map((o) => o.courier_name), presented.map((q) => q.courier));
    assert.deepEqual(options.map((o) => o.courier_name), ["Delhivery Surface", "Xpressbees Surface", "Ekart Surface"]);
    assert.deepEqual(options.map((o) => o.quoted_rate_paise), [6598, 9372, 9872]);
    assert.deepEqual(options.map((o) => o.is_cheapest_eligible), [true, false, false]);
    assert.equal(session.cheapest_eligible_paise, 6598);
    assert.equal(session.total_quote_count, 3);
    assert.equal(byName(options, "Xpressbees Surface").eta_days, 4);
    assert.equal(byName(options, "Ekart Surface").eta_text, "5 days");
    assert.equal(Date.parse(session.expires_at) - Date.parse(session.created_at), QUOTE_TTL_MS);
  });

  it("keeps ineligible rows staff saw, marks ties as cheapest, and records a provider outage", async () => {
    const results = providers(quote("shiprocket", "DTDC Air", 120), quote("shiprocket", "Ekart Surface", 80), quote("shiprocket", "Shadowfax Surface", 80), quote("shiprocket", "COD Only", 50, { prepaid: false }));
    const { session, options } = await compare(results);
    assert.deepEqual(options.filter((o) => o.is_cheapest_eligible).map((o) => o.courier_name).sort(), ["Ekart Surface", "Shadowfax Surface"]);
    const cod = byName(options, "COD Only");
    assert.equal(cod.eligible, false);
    assert.equal(cod.is_cheapest_eligible, false);
    assert.equal(cod.eligibility_reason, "Not eligible for prepaid notes");
    assert.equal(session.cheapest_eligible_paise, 8000, "an ineligible cheaper row is not the cheapest eligible");
    const outcomes = session.provider_outcomes as Array<{ provider: string; ok: boolean; error: string | null }>;
    assert.deepEqual(outcomes.find((p) => p.provider === "delhivery"), { provider: "delhivery", configured: true, ok: false, quotes: 0, error: "TIMEOUT" });
  });

  it("stores no street address, phone or raw provider payload", async () => {
    const { session, options } = await compare(providers(quote("delhivery", "Delhivery Surface", 65.98)));
    const text = JSON.stringify({ session, options });
    assert.equal(text.includes("Test Lane"), false);
    assert.doesNotMatch(text, /phone|line1|email|provider_payload/);
    assert.equal(session.destination_pincode, "834008");
    assert.equal(session.destination_city, "Ranchi");
  });

  it("classifies transport mode from the service name", () => {
    assert.equal(transportMode("Blue Dart Air", "Air"), "Air");
    assert.equal(transportMode("Delhivery Surface", "Surface"), "Surface");
    assert.equal(transportMode("Delhivery Express", ""), "Express");
    assert.equal(transportMode("Amazon", null), null);
  });
});

describe("selection and booking (spec 10–18, 53–55)", () => {
  it("normal comparison: Xpressbees chosen over cheaper Delhivery records +₹27.74", async () => {
    const { orderId, session, options } = await compare(providers(quote("delhivery", "Delhivery Surface", 65.98), quote("shiprocket", "Xpressbees Surface", 93.72), quote("shiprocket", "Ekart Surface", 98.72)));
    const attempt = await book(session, byName(options, "Xpressbees Surface"), "BOOKED", { awb: "AWBTEST1" });
    assert.equal(attempt.premium_paise, 2774);
    assert.equal(attempt.quoted_rate_paise, 9372);
    assert.equal(attempt.selected_by_name, "abhishek");
    const [view] = await views(orderId);
    assert.equal(view.outcome, "BOOKED");
    assert.equal(view.booked?.option.courier_name, "Xpressbees Surface");
    assert.equal(view.booked?.attempt.awb, "AWBTEST1");
    assert.equal(view.premiumPaise, 2774);
    assert.deepEqual(view.cheapest.map((o) => o.courier_name), ["Delhivery Surface"]);
    assert.equal(view.options.filter((o) => o.attempts.length).length, 1, "only the chosen option carries an attempt");
  });

  it("cheapest selected: premium is ₹0", async () => {
    const { orderId, session, options } = await compare(providers(quote("delhivery", "Delhivery Surface", 65.98), quote("shiprocket", "Xpressbees Surface", 93.72)));
    await book(session, byName(options, "Delhivery Surface"), "BOOKED");
    const [view] = await views(orderId);
    assert.equal(view.premiumPaise, 0);
  });

  it("failed cheap option then a second choice keeps both attempts in one session", async () => {
    const { orderId, session, options } = await compare(providers(quote("shiprocket", "Xpressbees Surface", 93.72), quote("shiprocket", "Blue Dart Air", 156.84)));
    await book(session, byName(options, "Xpressbees Surface"), "FAILED", { category: bookingFailureCategory({ message: "Unavailable — destination mismatch.", creates: 1 }) });
    await book(session, byName(options, "Blue Dart Air"), "BOOKED", { awb: "AWBBD1" });
    const [view] = await views(orderId);
    assert.equal(view.outcome, "BOOKED");
    assert.equal(view.booked?.option.courier_name, "Blue Dart Air");
    const xb = view.options.find((o) => o.courier_name === "Xpressbees Surface")!;
    assert.equal(xb.attempts[0].status, "FAILED");
    assert.equal(xb.attempts[0].failure_category, "ADDRESS_CONFIRMATION_FAILED");
    assert.equal(view.premiumPaise, 15684 - 9372);
    assert.equal(premiumPercent(15684, 9372), 67.3);
    assert.deepEqual(view.options.map((o) => o.quoted_rate_paise), [9372, 15684], "prices are never overwritten");
  });

  it("multiple comparisons are separate sessions, newest first, numbered from the oldest", async () => {
    const t0 = new Date(Date.now() - 40 * 60 * 1000);
    const first = await compare(providers(quote("delhivery", "Delhivery Surface", 70), quote("shiprocket", "Ekart Surface", 80), quote("shiprocket", "DTDC Air", 120)), { now: t0 });
    const second = await compare(providers(quote("delhivery", "Delhivery Surface", 68.94), quote("shiprocket", "Ekart Surface", 82), quote("shiprocket", "DTDC Air", 120), quote("shiprocket", "Blue Dart Air", 156.84)), { orderId: first.orderId });
    await book(second.session, byName(second.options, "Ekart Surface"), "BOOKED");
    const list = await views(first.orderId);
    assert.equal(list.length, 2);
    assert.equal(list[0].number, 2);
    assert.equal(list[0].outcome, "BOOKED");
    assert.equal(list[1].number, 1);
    assert.equal(list[1].outcome, "EXPIRED");
    assert.equal(list[1].options.length, 3, "the first session is untouched");
  });

  it("blocks stale rates, changed package, changed address, foreign and ineligible options", async () => {
    const { orderId, session, options } = await compare(providers(quote("delhivery", "Delhivery Surface", 65.98), quote("shiprocket", "COD Only", 40, { prepaid: false })));
    const option = byName(options, "Delhivery Surface");
    const fp = bookingFingerprint(PACK, ADDRESS);
    assert.deepEqual(checkSelection({ orderId, session, option, now: new Date(), fingerprint: fp }), { ok: true });
    const later = new Date(Date.parse(session.created_at) + QUOTE_TTL_MS + 1000);
    assert.equal((checkSelection({ orderId, session, option, now: later, fingerprint: fp }) as { category: string }).category, "RATE_EXPIRED");
    const heavier = bookingFingerprint({ ...PACK, weightGrams: 1000 }, ADDRESS);
    assert.equal((checkSelection({ orderId, session, option, now: new Date(), fingerprint: heavier }) as { category: string }).category, "PACKAGE_OR_ADDRESS_CHANGED");
    const moved = bookingFingerprint(PACK, { ...ADDRESS, pincode: "110055", city: "Delhi", state: "Delhi" });
    assert.equal((checkSelection({ orderId, session, option, now: new Date(), fingerprint: moved }) as { category: string }).category, "PACKAGE_OR_ADDRESS_CHANGED");
    assert.equal((checkSelection({ orderId: "another-order", session, option, now: new Date(), fingerprint: fp }) as { category: string }).category, "QUOTE_NOT_FOUND");
    const other = await compare(providers(quote("delhivery", "Delhivery Surface", 10)));
    assert.equal((checkSelection({ orderId, session, option: other.options[0], now: new Date(), fingerprint: fp }) as { category: string }).category, "QUOTE_NOT_FOUND", "an option from another session is rejected");
    assert.equal((checkSelection({ orderId, session, option: byName(options, "COD Only"), now: new Date(), fingerprint: fp }) as { category: string }).category, "QUOTE_NOT_ELIGIBLE");
  });

  it("a replayed Compare request reuses the saved session", async () => {
    const first = await compare(providers(quote("delhivery", "Delhivery Surface", 65.98)), { requestKey: "order-x:key-123456789" });
    const replay = await findSessionByRequestKey(db, first.orderId, "order-x:key-123456789");
    assert.equal(replay?.id, first.session.id);
    assert.equal(await findSessionByRequestKey(db, "someone-else", "order-x:key-123456789"), null);
  });

  it("orders list gets counts and booked-vs-cheapest only", async () => {
    const { orderId, session, options } = await compare(providers(quote("delhivery", "Delhivery Surface", 68.94), quote("shiprocket", "Blue Dart Air", 156.84)));
    await book(session, byName(options, "Blue Dart Air"), "BOOKED");
    const summary = (await historySummaries(db, [orderId])).get(orderId);
    assert.deepEqual(summary, { sessions: 1, lastOptionCount: 2, bookedPaise: 15684, cheapestPaise: 6894, premiumPaise: 8790 });
    const ops = { stage: { key: "pickup", label: "Pickup", position: 6, total: 9 }, courier: "Blue Dart Air", rate_paise: 15684, issue: null, quote_history: { sessions: 1, options: 2, cheapest_paise: 6894, premium_paise: 8790 } } as unknown as OrderOps;
    assert.equal(quoteHistoryLine(ops), "2 options compared · cheapest ₹68.94");
    assert.equal(quoteHistoryLine({ ...ops, quote_history: { ...ops.quote_history!, premium_paise: 1000 } }), "2 options compared");
    assert.equal(quoteHistoryLine({ ...ops, quote_history: null }), null, "old orders show nothing extra");
    assert.equal(opsLines({ status: "PICKUP_SCHEDULED", ops }).quotes, "2 options compared · cheapest ₹68.94");
  });

  it("a historical order without recorded comparisons has no fabricated sessions", async () => {
    assert.deepEqual(await views("00000000-0000-4000-9000-999999999999"), []);
  });
});

describe("premium notice (spec 73–75)", () => {
  const quotes = [
    { courier: "Delhivery Surface", ratePaise: 6894, eligible: true },
    { courier: "Blue Dart Air", ratePaise: 15684, eligible: true },
    { courier: "Xpressbees Surface", ratePaise: 8000, eligible: true },
  ];
  it("is neutral and only above the ₹25 band", () => {
    assert.equal(PREMIUM_NOTICE_PAISE, 2500);
    assert.equal(selectionPremiumNotice({ courier: "Blue Dart Air", ratePaise: 15684 }, quotes), "Blue Dart Air is ₹87.90 more than the cheapest eligible option, Delhivery Surface.");
    assert.equal(selectionPremiumNotice({ courier: "Xpressbees Surface", ratePaise: 8000 }, quotes), null);
    assert.equal(selectionPremiumNotice({ courier: "Delhivery Surface", ratePaise: 6894 }, quotes), null);
  });
});

describe("route and schema contracts (spec 9, 10, 11, 37–41, 67)", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const rates = read("app/api/admin/notes/orders/[id]/rates/route.ts");
  const dispatch = read("app/api/admin/notes/orders/[id]/dispatch/route.ts");
  const picker = read("components/notes/admin/orders/CourierPicker.tsx");
  const history = read("app/api/admin/notes/orders/[id]/courier-history/route.ts");
  const lib = read("lib/store/shipping/quoteHistory.ts");
  const sql = read("supabase/migrations/2026-10-04-notes-store-courier-quote-history.sql");

  it("rates: one provider comparison per request, replay checked first, fail closed when not saved", () => {
    assert.equal(rates.match(/compareCourierRates\(/g)?.length, 1);
    assert.ok(rates.indexOf("await findSessionByRequestKey(") < rates.indexOf("await compareCourierRates({"));
    assert.ok(rates.indexOf("await persistQuoteSession(") > rates.indexOf("await compareCourierRates({"));
    assert.match(rates, /QUOTE_SAVE_FAILED/);
    assert.doesNotMatch(lib, /quoteShiprocket|quoteDelhivery|compareCourierRates|createProviderShipment/, "history code never calls a provider");
  });

  it("dispatch: price, courier and provider come only from the saved option; attempt recorded before create", () => {
    assert.doesNotMatch(dispatch, /body\?\.(rate_paise|provider|courier_id|courier|service)\b/);
    assert.match(dispatch, /quote_session_id/);
    assert.match(dispatch, /quote_option_id/);
    const create = dispatch.indexOf("createProviderShipment({");
    assert.ok(dispatch.indexOf("fingerprint: bookingFingerprint") < create);
    assert.ok(dispatch.indexOf("startAttempt(db, { session: quoteSession, option: quoteOption, actor })") < create);
    assert.equal(dispatch.match(/createProviderShipment\(/g)?.length, 1);
    for (const keep of ["dispatchBlocked", "confirm_city", "decline_city", "normalizedCustomerPhone", "fulfillment_lock_at", "shipmentAlreadyActive"]) assert.match(dispatch, new RegExp(keep));
  });

  it("picker sends only saved ids and keeps manual selection", () => {
    assert.match(picker, /quote_session_id: sessionId, quote_option_id: chosen\.key/);
    assert.doesNotMatch(picker, /rate_paise: chosen/);
    assert.match(picker, /explicitCourierSelection\(null\)/);
    assert.match(picker, /Confirm booking/);
  });

  it("history API is staff-only and read-only", () => {
    assert.match(history, /requireStoreOrderRead/);
    assert.doesNotMatch(history, /\.(insert|update|upsert|delete)\(/);
  });

  it("migration is additive, idempotent, RLS-protected and has no PII columns", () => {
    assert.doesNotMatch(sql, /\bdrop\b|\btruncate\b|\bupdate\s+public\.|alter\s+table\s+public\.store_(orders|shipments)\b/i);
    assert.equal((sql.match(/create table if not exists/g) || []).length, 3);
    assert.equal((sql.match(/enable row level security/g) || []).length, 3);
    const code = sql.replace(/--.*$/gm, "");
    assert.doesNotMatch(code, /\b(phone|email|line1|line2|address_line)\b/i);
  });
});
