/**
 * Notes Store commerce analytics.
 * Channel labels here are the Notes business channels. Webinar `deriveChannel`
 * stays on the coarse CRM set and is asserted unchanged.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildTouch, chooseCookieValue, deriveChannel, mergeAttribution, serializeAttr, type AttributionTouch } from "../../lib/attribution";
import { CLIENT_ALLOWED_EVENTS } from "../../lib/analytics/events";
import {
  aggregateNotesAnalytics,
  buildNotesCampaignUrl,
  businessChannel,
  externalNotesDispatch,
  isQaState,
  notesPaymentFailDedupeKey,
  notesPaymentInitDedupeKey,
  notesPurchaseDedupeKey,
  orderMarketingSummary,
  stripAnalyticsProps,
  type NotesEventRow,
  type NotesOrderFact,
} from "../../lib/analytics/notesCommerce";

function touch(params: Record<string, string>, path = "/notes"): AttributionTouch {
  return buildTouch({ params, referrer: null, path });
}

describe("business channels", () => {
  it("splits Instagram story, reel, auto-dm, and organic", () => {
    assert.equal(businessChannel(touch({ utm_source: "instagram", utm_medium: "story" })), "Instagram Story");
    assert.equal(businessChannel(touch({ utm_source: "instagram", utm_medium: "reel" })), "Instagram Reel");
    assert.equal(businessChannel(touch({ utm_source: "instagram", utm_medium: "autodm" })), "Instagram Auto-DM");
    assert.equal(businessChannel(touch({ utm_source: "instagram", utm_medium: "bio" })), "Instagram Organic");
  });

  it("treats paid Meta and Google click ids as ads, and leaves webinar channels alone", () => {
    const meta = { ...touch({ utm_source: "meta", utm_medium: "paid_social", utm_campaign: "notes_launch" }), fbclid: "fb-1" };
    const google = { ...touch({ utm_source: "google", utm_medium: "cpc" }), gclid: "g-1", gbraid: "gb", wbraid: "wb" };
    assert.equal(businessChannel(meta), "Meta Ads");
    assert.equal(businessChannel(google), "Google Ads");
    assert.equal(businessChannel(touch({ utm_source: "whatsapp", utm_medium: "message" })), "WhatsApp");
    assert.equal(businessChannel(touch({ utm_source: "telegram", utm_medium: "community" })), "Telegram");
    assert.equal(businessChannel(touch({ utm_source: "youtube", utm_medium: "organic" })), "YouTube");
    assert.equal(deriveChannel(touch({ utm_source: "instagram", utm_medium: "story", utm_campaign: "notes_launch" })), "Organic");
    assert.equal(deriveChannel(google), "Google Ads");
  });
});

describe("first and last touch", () => {
  it("keeps the Instagram story first touch when a later visit is direct", () => {
    const story = touch({ utm_source: "instagram", utm_medium: "story", utm_campaign: "notes_launch", utm_content: "polity_story_01" });
    const first = mergeAttribution(null, story, "2026-09-27T01:00:00.000Z");
    const direct = touch({});
    const next = mergeAttribution(first, direct, "2026-09-27T05:00:00.000Z");
    assert.equal(next.first_touch?.source, "instagram");
    assert.equal(next.first_touch?.medium, "story");
    assert.equal(next.first_touch?.campaign, "notes_launch");
    assert.equal(next.last_touch?.source, "instagram");
    assert.equal(next.last_touch?.campaign, "notes_launch");
  });

  it("updates last touch on a new acquisition without moving first touch", () => {
    const story = touch({ utm_source: "instagram", utm_medium: "story", utm_campaign: "notes_launch", utm_content: "polity" });
    const first = mergeAttribution(null, story, "2026-09-27T01:00:00.000Z");
    const telegram = touch({ utm_source: "telegram", utm_medium: "community", utm_campaign: "notes_launch", utm_content: "economy" });
    const next = mergeAttribution(first, telegram, "2026-09-27T06:00:00.000Z");
    assert.equal(businessChannel(next.first_touch), "Instagram Story");
    assert.equal(businessChannel(next.last_touch), "Telegram");
    assert.equal(next.last_touch?.content, "economy");
  });
});

describe("privacy", () => {
  it("drops phone, email, address, and name, and keeps product fields", () => {
    const safe = stripAnalyticsProps({
      product_id: "polity-id",
      product_name: "Indian Polity Notes",
      phone: "9876543210",
      email: "student@example.com",
      address: "12 MG Road",
      name: "Naman",
      note: "call me at 9876543210",
      price_paise: 299900,
    });
    assert.equal(safe.product_id, "polity-id");
    assert.equal(safe.product_name, "Indian Polity Notes");
    assert.equal(safe.price_paise, 299900);
    assert.equal("phone" in safe, false);
    assert.equal("email" in safe, false);
    assert.equal("address" in safe, false);
    assert.equal("name" in safe, false);
    assert.equal("note" in safe, false);
    assert.equal(JSON.stringify(safe).includes("9876543210"), false);
    assert.equal(JSON.stringify(safe).includes("student@example.com"), false);
  });

  it("does not copy click ids into the staff marketing summary", () => {
    const summary = orderMarketingSummary({
      attribution_platform: "Instagram Story",
      attribution_json: {
        first_touch: { ...touch({ utm_source: "instagram", utm_medium: "story", utm_campaign: "notes_launch", utm_content: "reel_polity_01" }), fbclid: "fb-secret", first_seen_at: "2026-09-27T01:00:00.000Z" },
        last_touch: { ...touch({ utm_source: "instagram", utm_medium: "autodm", utm_campaign: "notes_launch", utm_content: "reel_polity_01" }), fbclid: "fb-last", gclid: null, last_seen_at: "2026-09-27T02:00:00.000Z" },
        device_category: "mobile",
      },
    });
    const encoded = JSON.stringify(summary);
    assert.equal(summary?.source, "instagram");
    assert.equal(summary?.medium, "autodm");
    assert.equal(summary?.first_channel, "Instagram Story");
    assert.equal(summary?.last_channel, "Instagram Auto-DM");
    assert.equal(encoded.includes("fb-secret"), false);
    assert.equal(encoded.includes("fb-last"), false);
    assert.equal(encoded.includes("fbclid"), false);
  });
});

describe("shared host cookies", () => {
  it("prefers the campaign cookie when a stale host-only Direct cookie is also present", () => {
    const stale = serializeAttr({
      first_touch: { ...touch({}), first_seen_at: "2026-09-01T00:00:00.000Z" },
      last_touch: { ...touch({}), last_seen_at: "2026-09-01T00:00:00.000Z" },
    });
    const current = serializeAttr({
      first_touch: { ...touch({ utm_source: "instagram", utm_medium: "story", utm_campaign: "notes_launch" }), first_seen_at: "2026-09-27T00:00:00.000Z" },
      last_touch: { ...touch({ utm_source: "instagram", utm_medium: "autodm", utm_campaign: "notes_launch", utm_content: "reel_01" }), last_seen_at: "2026-09-27T01:00:00.000Z" },
    });
    const header = `nsa_attr=${stale}; nsa_sid=old; nsa_attr=${current}`;
    const chosen = chooseCookieValue("nsa_attr", header);
    const state = JSON.parse(decodeURIComponent(chosen || ""));
    assert.equal(state.last_touch.medium, "autodm");
    assert.equal(state.last_touch.campaign, "notes_launch");
  });
});

describe("campaign links and purchase identity", () => {
  it("builds a www campaign URL", () => {
    assert.equal(
      buildNotesCampaignUrl({
        destination: "polity",
        source: "Instagram",
        medium: "Story",
        campaign: "notes launch",
        content: "polity_story_01",
      }),
      "https://www.namanias.com/notes/polity?utm_source=instagram&utm_medium=story&utm_campaign=notes_launch&utm_content=polity_story_01",
    );
  });

  it("uses one purchase key per order", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    assert.equal(notesPurchaseDedupeKey(id), notesPurchaseDedupeKey(id));
    assert.notEqual(notesPurchaseDedupeKey(id), notesPurchaseDedupeKey("22222222-2222-2222-2222-222222222222"));
    assert.equal(notesPaymentInitDedupeKey(id), `notes_payment_initiated:${id}`);
    assert.equal(notesPaymentFailDedupeKey(id, "failed"), notesPaymentFailDedupeKey(id, "failed"));
  });

  it("does not let the browser emit purchase, and does not map it to a client conversion", () => {
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_purchase"), false);
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_payment_initiated"), false);
    assert.equal(externalNotesDispatch("notes_purchase", { order_no: "NIAS-N-2026-001001" }).ga4, null);
    assert.equal(externalNotesDispatch("notes_order_completed", { order_no: "NIAS-N-2026-001001" }).ga4, null);
    assert.equal(externalNotesDispatch("notes_added_to_cart", { product_id: "p1", price_paise: 299900 }).ga4?.name, "add_to_cart");
    assert.equal(externalNotesDispatch("notes_product_viewed", { product_id: "p1" }).meta?.name, "ViewContent");
  });

  it("records purchase only from the captured payment branch", () => {
    const src = readFileSync(new URL("../../lib/store/payments/verify.ts", import.meta.url), "utf8");
    const purchaseAt = src.indexOf("recordNotesPurchase");
    const failAt = src.indexOf("recordNotesPaymentFailed");
    assert.ok(purchaseAt > 0);
    assert.ok(failAt > purchaseAt);
    assert.equal(src.split("recordNotesPurchase").length - 1, 1);
  });
});

describe("funnel aggregation", () => {
  const story = {
    first_touch: { ...touch({ utm_source: "instagram", utm_medium: "story", utm_campaign: "notes_launch", utm_content: "polity_story_01" }), first_seen_at: "2026-09-27T01:00:00.000Z" },
    last_touch: { ...touch({ utm_source: "instagram", utm_medium: "story", utm_campaign: "notes_launch", utm_content: "polity_story_01" }), last_seen_at: "2026-09-27T01:00:00.000Z" },
  };

  function event(name: string, session: string, props: Record<string, unknown> = {}): NotesEventRow {
    return {
      event_name: name,
      session_id: session,
      occurred_at: "2026-09-27T02:00:00.000Z",
      attribution: story,
      device: { type: "mobile", browser: "Safari", os: "iOS" },
      props,
    };
  }

  it("counts people, drop-off, revenue, and excludes QA plus unpaid orders", () => {
    const events = [
      event("notes_store_viewed", "s1"),
      event("notes_store_viewed", "s2"),
      event("notes_product_clicked", "s1", { subject: "polity", product_id: "polity", cta_id: "subject_card" }),
      event("notes_product_viewed", "s1", { subject: "polity", product_id: "polity" }),
      event("notes_sample_opened", "s1", { product_id: "polity", sample_id: "preamble" }),
      event("notes_physical_video_play", "s1", { product_id: "polity", cta_id: "sample_video" }),
      event("notes_physical_video_50", "s1", { product_id: "polity", progress_percent: 50 }),
      event("notes_physical_video_completed", "s1", { product_id: "polity" }),
      event("notes_added_to_cart", "s1", { product_id: "polity", cta_id: "add_to_cart" }),
      event("notes_checkout_started", "s1"),
      event("notes_checkout_validation_error", "s1", { field: "pin", reason: "invalid_pin" }),
      event("notes_payment_initiated", "s1"),
      event("notes_store_viewed", "qa", { is_test: true }),
    ];
    const orders: NotesOrderFact[] = [
      {
        id: "paid",
        status: "ORDER_CONFIRMED",
        total_paise: 299900,
        paid_at: "2026-09-27T03:00:00.000Z",
        promo_code: "LAUNCH",
        attribution_json: { ...story, device_category: "mobile" },
      },
      {
        id: "pending",
        status: "PAYMENT_PENDING",
        total_paise: 299900,
        paid_at: null,
        attribution_json: story,
      },
      {
        id: "qa-order",
        status: "ORDER_CONFIRMED",
        total_paise: 100,
        paid_at: "2026-09-27T03:00:00.000Z",
        attribution_source: "qa",
        attribution_json: story,
      },
    ];
    const report = aggregateNotesAnalytics(events, orders, [
      { order_id: "paid", product_id: "polity", name_snapshot: "Indian Polity Notes", line_total_paise: 299900 },
    ]);
    assert.equal(report.kpis.visitors, 2);
    assert.equal(report.kpis.productViewers, 1);
    assert.equal(report.kpis.addToCarts, 1);
    assert.equal(report.kpis.checkouts, 1);
    assert.equal(report.kpis.paidOrders, 1);
    assert.equal(report.kpis.revenuePaise, 299900);
    assert.equal(report.subjects.polity.clicks, 1);
    assert.equal(report.subjects.polity.people, 1);
    assert.equal(report.content.pdfPeople, 1);
    assert.equal(report.content.videoStarts, 1);
    assert.equal(report.content.video50, 1);
    assert.equal(report.content.videoCompletes, 1);
    assert.equal(report.checkoutHealth.validationErrors, 1);
    assert.equal(report.checkoutHealth.topErrors[0]?.key, "invalid_pin");
    assert.equal(report.excludedTestEvents, 1);
    assert.equal(report.sources[0]?.channel, "Instagram Story");
    assert.equal(report.sources[0]?.revenuePaise, 299900);
    assert.equal(report.campaigns[0]?.content, "polity_story_01");
    assert.equal(report.devices.find((row) => row.device === "mobile")?.purchases, 1);
    assert.equal(report.promotions.find((row) => row.code === "LAUNCH")?.orders, 1);
    assert.equal(report.largestDrop?.label.includes("→"), true);
    assert.equal(isQaState({ first_touch: { ...touch({ utm_source: "qa", utm_medium: "test", utm_campaign: "notes_analytics_validation" }), first_seen_at: "t" }, last_touch: null }), true);
  });
});
