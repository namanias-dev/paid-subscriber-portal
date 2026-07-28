import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveMasterclass,
  deriveFoundation,
  deriveByCategory,
  deriveRecommendations,
  hasOfflineAdmissions,
  rupees,
} from "../../lib/homeCinematic/offers";
import { classifyStats, classifyTrustBar, renderable } from "../../lib/homeCinematic/trust";
import {
  guardCourses,
  guardWebinars,
  isWholesaleFallback,
  hasFabricatedRegistrationCount,
} from "../../lib/homeCinematic/fixtureGuard";
import { isCinematicHomeEnabled } from "../../lib/homeCinematic/flag";
import { CLIENT_ALLOWED_EVENTS } from "../../lib/analytics/events";
import { DEFAULT_HERO, DEFAULT_CONTENT } from "../../lib/homeDefaults";
import type { Course, Webinar, HeroStat, Topper } from "../../lib/types";

const HOUR = 3600_000;
const NOW = Date.parse("2026-07-27T12:00:00.000Z");

function course(p: Partial<Course>): Course {
  return {
    id: p.id ?? "c1",
    slug: p.slug ?? "slug",
    title: p.title ?? "Course",
    category: (p.category ?? "Foundation") as Course["category"],
    description: "",
    modes: p.modes ?? ["Online"],
    price: p.price ?? 1000,
    original_price: p.original_price ?? null,
    capacity: p.capacity ?? null,
    seats_left: p.seats_left ?? null,
    status: p.status ?? "published",
    active: p.active ?? true,
    featured: p.featured ?? false,
    batch_start: p.batch_start ?? null,
    display_order: p.display_order ?? null,
    ...p,
  } as Course;
}

function webinar(p: Partial<Webinar>): Webinar {
  return {
    id: p.id ?? "w1",
    slug: p.slug ?? "w-slug",
    title: p.title ?? "Masterclass",
    datetime: p.datetime ?? new Date(NOW + 48 * HOUR).toISOString(),
    price: p.price ?? 50,
    status: p.status ?? "upcoming",
    active: p.active ?? true,
    ...p,
  } as Webinar;
}

// ───────────────────────── the ₹50 masterclass is never hardcoded ────────────

test("masterclass price and href come from the live row, not a constant", () => {
  const w = webinar({ slug: "aug-1-masterclass", price: 50 });
  const offer = deriveMasterclass([w], NOW);
  assert.ok(offer);
  assert.equal(offer.href, "/webinars/aug-1-masterclass");
  assert.equal(offer.price, 50);

  // Change the price in the data and the offer follows it.
  const repriced = deriveMasterclass([webinar({ slug: "s", price: 99 })], NOW);
  assert.equal(repriced?.price, 99);
});

test("a webinar whose start time has passed is never offered", () => {
  const past = webinar({ slug: "ended", datetime: new Date(NOW - HOUR).toISOString() });
  assert.equal(deriveMasterclass([past], NOW), null);
});

test("an inactive webinar is never offered even when it is marked upcoming", () => {
  // This is the exact shape of the fixture row `how-to-choose-optional` in prod:
  // status=upcoming, active=false.
  const fixture = webinar({ slug: "how-to-choose-optional", status: "upcoming", active: false, price: 0 });
  assert.equal(deriveMasterclass([fixture], NOW), null);
});

test("the soonest open paid session wins", () => {
  const later = webinar({ id: "a", slug: "later", datetime: new Date(NOW + 10 * 24 * HOUR).toISOString() });
  const sooner = webinar({ id: "b", slug: "sooner", datetime: new Date(NOW + 2 * 24 * HOUR).toISOString() });
  assert.equal(deriveMasterclass([later, sooner], NOW)?.slug, "sooner");
});

// ───────────────────────── published != bookable ────────────────────────────

test("a published-but-inactive course is never recommended", () => {
  const inactive = course({ slug: "safalta-online-foundation", status: "published", active: false });
  assert.equal(deriveFoundation([inactive]), null);
});

test("foundation pick prefers featured, then the soonest batch start", () => {
  const plain = course({ id: "1", slug: "plain", featured: false, batch_start: "2026-08-01T00:00:00Z" });
  const featuredLater = course({ id: "2", slug: "flagship", featured: true, batch_start: "2026-09-01T00:00:00Z" });
  assert.equal(deriveFoundation([plain, featuredLater])?.slug, "flagship");
});

test("original_price is only surfaced when it is genuinely higher", () => {
  const good = deriveByCategory([course({ slug: "a", price: 100, original_price: 200 })], "Foundation");
  assert.equal(good?.originalPrice, 200);
  const bogus = deriveByCategory([course({ slug: "b", price: 200, original_price: 200 })], "Foundation");
  assert.equal(bogus?.originalPrice, null);
});

test("seat counts are suppressed unless the row carries a real capacity and remainder", () => {
  assert.equal(deriveByCategory([course({ slug: "a", capacity: null, seats_left: 5 })], "Foundation")?.seatsLeft, null);
  assert.equal(deriveByCategory([course({ slug: "b", capacity: 40, seats_left: 0 })], "Foundation")?.seatsLeft, null);
  assert.equal(deriveByCategory([course({ slug: "c", capacity: 40, seats_left: 99 })], "Foundation")?.seatsLeft, null);
  assert.equal(deriveByCategory([course({ slug: "d", capacity: 40, seats_left: 20 })], "Foundation")?.seatsLeft, 20);
});

// ───────────────────────── the selector never lies ──────────────────────────

test("the Chandigarh answer returns nothing when no offline batch is bookable", () => {
  const onlineOnly = [course({ slug: "online", modes: ["Online"] })];
  assert.equal(hasOfflineAdmissions(onlineOnly), false);
  const recs = deriveRecommendations(onlineOnly, [], [{ key: "chandigarh", categories: ["Foundation"], offline: true }], NOW);
  assert.equal(recs.chandigarh, null);
});

test("the Chandigarh answer resolves when an offline batch is open", () => {
  const offline = [course({ slug: "offline-batch", modes: ["Offline"] })];
  assert.equal(hasOfflineAdmissions(offline), true);
  const recs = deriveRecommendations(offline, [], [{ key: "chandigarh", categories: ["Foundation"], offline: true }], NOW);
  assert.equal(recs.chandigarh?.slug, "offline-batch");
});

test("a beginner is pointed at the masterclass when one is open", () => {
  const recs = deriveRecommendations(
    [course({ slug: "found", category: "Foundation" })],
    [webinar({ slug: "mc" })],
    [{ key: "zero", categories: ["Entry", "Foundation"], preferMasterclass: true }],
    NOW,
  );
  assert.equal(recs.zero?.slug, "mc");
});

test("recommendations fall through category preferences in order", () => {
  const recs = deriveRecommendations(
    [course({ slug: "ts", category: "Test Series", price: 7000 })],
    [],
    [{ key: "preparing", categories: ["Mains", "Test Series"] }],
    NOW,
  );
  assert.equal(recs.preparing?.slug, "ts");
});

// ───────────────────────── provenance gate ──────────────────────────────────

test("hero stats identical to the code default are refused wholesale", () => {
  const items = classifyStats(DEFAULT_HERO.stats as HeroStat[], []);
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.provenance === "code-default" && !i.renderable));
  assert.equal(renderable(items).length, 0);
});

test("admin-authored stats are renderable even when one value coincides with the seed", () => {
  // Production's real shape: the array differs from the default, but the YouTube
  // entry happens to match it exactly. That entry must NOT be discarded.
  const prod: HeroStat[] = [
    { value: 500, suffix: "K+", label: "Instagram" },
    { value: 220, suffix: "K+", label: "YouTube" },
    { value: 15, suffix: "+", label: "Years" },
  ];
  const items = classifyStats(prod, [{ id: "t", name: "A", rank: "AIR-84" } as Topper]);
  assert.ok(items.every((i) => i.provenance === "admin" && i.renderable));
  assert.deepEqual(
    items.map((i) => i.display),
    ["500K+", "220K+", "15+"],
  );
});

test("a rank claim our own toppers list cannot evidence is omitted", () => {
  const toppers = [
    { id: "1", name: "A", rank: "AIR-351" },
    { id: "2", name: "B", rank: "AIR-845" },
  ] as Topper[];
  const items = classifyStats(
    [
      { value: 500, suffix: "K+", label: "Instagram" },
      { value: 100, suffix: "+", label: "Top AIRs" },
    ],
    toppers,
  );
  const airs = items.find((i) => i.label === "Top AIRs");
  assert.equal(airs?.provenance, "contradicted");
  assert.equal(airs?.renderable, false);
  // and the honest one survives
  assert.equal(items.find((i) => i.label === "Instagram")?.renderable, true);
});

test("no figure is ever rounded or reformatted on its way to the UI", () => {
  const items = classifyStats([{ value: 12345, suffix: "+", label: "Custom" }], []);
  assert.equal(items[0].display, "12,345+"); // grouped, never rounded to 12K
});

test("a trust bar identical to the code default publishes nothing", () => {
  const items = classifyTrustBar(DEFAULT_CONTENT.trust_bar);
  assert.equal(renderable(items).length, 0);
});

test("admin trust bar strips leading emoji but keeps the claim verbatim", () => {
  const items = classifyTrustBar(["⭐ 500K+ Instagram", "📍 Chandigarh - Sector 17C"]);
  assert.deepEqual(renderable(items).map((i) => i.display), ["500K+ Instagram", "Chandigarh - Sector 17C"]);
});

// ───────────────────────── fixture guard ────────────────────────────────────

test("a row set made entirely of fixture ids is treated as the mock fallback", () => {
  assert.equal(isWholesaleFallback(["co-a", "co-b"], new Set(["co-a", "co-b", "co-c"])), true);
  // A real table containing SOME seeded rows plus admin rows is not a fallback.
  assert.equal(isWholesaleFallback(["co-a", "uuid-1"], new Set(["co-a"])), false);
  assert.equal(isWholesaleFallback([], new Set(["co-a"])), false);
});

test("guardCourses suppresses everything when every id is a known fixture", () => {
  const res = guardCourses([course({ id: "co-masterclass" }), course({ id: "co-demo" })]);
  assert.equal(res.suppressed, true);
  assert.equal(res.rows.length, 0);
});

test("guardCourses passes a real table through untouched", () => {
  const rows = [course({ id: "52457ce7-ddac-4417-a694-56d85b8a70ad" }), course({ id: "co-psir" })];
  const res = guardCourses(rows);
  assert.equal(res.suppressed, false);
  assert.equal(res.rows.length, 2);
});

test("hand-set registration counters are recognised as fabricated", () => {
  const manual = webinar({ id: "web-optional", registrations: 873 });
  (manual as Webinar & { registrations_source?: string }).registrations_source = "aggregate_manual";
  assert.equal(hasFabricatedRegistrationCount(manual), true);

  const real = webinar({ id: "6618a2cf", registrations: 0 });
  (real as Webinar & { registrations_source?: string }).registrations_source = "row_level";
  assert.equal(hasFabricatedRegistrationCount(real), false);
});

test("guardWebinars drops fixture rows carrying fabricated counters but keeps real ones", () => {
  const fixture = webinar({ id: "web-prelims", slug: "prelims-2026-strategy", registrations: 1540 });
  (fixture as Webinar & { registrations_source?: string }).registrations_source = "aggregate_manual";
  const real = webinar({ id: "6618a2cf", slug: "august-masterclass" });
  const res = guardWebinars([fixture, real]);
  assert.equal(res.suppressed, false);
  assert.deepEqual(res.rows.map((w) => w.slug), ["august-masterclass"]);
});

// ───────────────────────── flag + analytics contract ────────────────────────

test("the preview flag is off unless explicitly set to the string true", () => {
  const prev = process.env.NEXT_PUBLIC_CINEMATIC_HOME_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_CINEMATIC_HOME_ENABLED;
    assert.equal(isCinematicHomeEnabled(), false);
    process.env.NEXT_PUBLIC_CINEMATIC_HOME_ENABLED = "1";
    assert.equal(isCinematicHomeEnabled(), false);
    process.env.NEXT_PUBLIC_CINEMATIC_HOME_ENABLED = "TRUE";
    assert.equal(isCinematicHomeEnabled(), false);
    process.env.NEXT_PUBLIC_CINEMATIC_HOME_ENABLED = "true";
    assert.equal(isCinematicHomeEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_CINEMATIC_HOME_ENABLED;
    else process.env.NEXT_PUBLIC_CINEMATIC_HOME_ENABLED = prev;
  }
});

test("every pre-existing client event is still allow-listed (append-only proof)", () => {
  // The events.ts change must be purely additive. These are the events that
  // existed before the cinematic preview was added.
  const PRE_EXISTING = [
    "page_view", "session_start", "webinar_view", "course_view", "click_register_pay",
    "registration_attempt", "click_enroll", "enrolled_card_viewed", "zoom_link_clicked",
    "course_opened", "resource_download_click", "download_lead_prompt", "download_lead_submit",
    "announcement_click", "consent_updated", "ai_widget_opened", "ai_widget_dismissed",
    "ai_message_sent", "ai_quick_reply", "ai_lead_created", "ai_webinar_register_click",
    "ai_payment_start_click", "ai_whatsapp_click", "ai_callback_requested",
    "ai_payment_recovery_click", "ai_resource_click", "ai_offer_click", "ai_conversion_attributed",
  ] as const;
  for (const e of PRE_EXISTING) {
    assert.ok(CLIENT_ALLOWED_EVENTS.has(e), `pre-existing event ${e} must remain allow-listed`);
  }
});

test("the new cinematic events are allow-listed so /api/track will not reject them", () => {
  const NEW = [
    "cinematic_home_view", "cinematic_mode_loaded", "cinematic_fallback_used",
    "hero_masterclass_click", "hero_course_click", "hero_quiz_click",
    "journey_stage_viewed", "journey_selector_completed", "journey_recommendation_clicked",
    "mentor_cta_clicked", "course_card_clicked", "result_card_clicked",
    "portal_showcase_clicked", "whatsapp_clicked", "final_cta_clicked",
    "scroll_depth_25", "scroll_depth_50", "scroll_depth_75", "scroll_depth_100",
  ] as const;
  for (const e of NEW) assert.ok(CLIENT_ALLOWED_EVENTS.has(e), `${e} must be allow-listed`);
});

test("rupee formatting uses the Indian grouping and never rounds to thousands", () => {
  assert.equal(rupees(50), "₹50");
  assert.equal(rupees(75000), "₹75,000");
  assert.equal(rupees(100000), "₹1,00,000");
});
