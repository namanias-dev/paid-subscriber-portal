/**
 * Notes Store commerce analytics — pure helpers.
 *
 * Reuses the academy first-party attribution cookie (nsa_attr) and the
 * analytics_events beacon. This file does not talk to GA, Meta, or the database.
 * Webinar channel derivation (`deriveChannel`) is intentionally untouched.
 */
import type { AttributionState, AttributionTouch } from "@/lib/attribution";

export const NOTES_SCHEMA_VERSION = 1;
export const NOTES_QA_CAMPAIGN = "notes_analytics_validation";
export const CAMPAIGN_HOST = "https://www.namanias.com";

export const BUSINESS_CHANNELS = [
  "Instagram Organic",
  "Instagram Story",
  "Instagram Reel",
  "Instagram Auto-DM",
  "Meta Ads",
  "Google Ads",
  "Google Organic",
  "WhatsApp",
  "Telegram",
  "YouTube",
  "Direct",
  "Referral",
  "Internal",
  "Unknown",
] as const;

export type BusinessChannel = (typeof BUSINESS_CHANNELS)[number];

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paid_social", "paid_search", "cpm", "display"]);

function clean(v: string | null | undefined): string {
  return (v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Business channel for Notes reporting. Does not replace webinar `deriveChannel`. */
export function businessChannel(touch: AttributionTouch | null | undefined): BusinessChannel {
  if (!touch) return "Unknown";
  const source = clean(touch.source);
  const medium = clean(touch.medium);
  const paid = PAID_MEDIUMS.has(medium);
  const googleClick = !!(touch.gclid || touch.gbraid || touch.wbraid);
  if (googleClick || (source === "google" && paid) || (source === "google" && medium === "cpc")) return "Google Ads";
  const metaClick = !!(touch.fbclid || touch.fbc);
  if (source === "meta" || (metaClick && paid) || ((source === "facebook" || source === "instagram") && paid)) return "Meta Ads";
  if (source === "instagram") {
    if (medium === "story" || medium === "stories") return "Instagram Story";
    if (medium === "reel" || medium === "reels") return "Instagram Reel";
    if (medium === "autodm" || medium === "auto_dm" || medium === "manychat") return "Instagram Auto-DM";
    return "Instagram Organic";
  }
  if (source === "facebook") return "Referral";
  if (source === "whatsapp") return "WhatsApp";
  if (source === "telegram") return "Telegram";
  if (source === "youtube") return "YouTube";
  if (source === "google") return "Google Organic";
  if (source === "internal") return "Internal";
  if (source === "referral") return "Referral";
  if (source === "direct" || !source) return "Direct";
  return "Unknown";
}

export function isQaTouch(touch: AttributionTouch | null | undefined): boolean {
  if (!touch) return false;
  return clean(touch.source) === "qa" || clean(touch.campaign) === NOTES_QA_CAMPAIGN;
}

export function isQaState(state: AttributionState | null | undefined): boolean {
  return isQaTouch(state?.last_touch) || isQaTouch(state?.first_touch);
}

/** Extra device fields ride on the order JSON. Click ids stay in the same blob and are not copied out. */
export type StoredNotesAttribution = AttributionState & {
  device_category?: string | null;
  device_browser?: string | null;
  device_os?: string | null;
};

export interface OrderMarketingSummary {
  channel: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  landing_page: string | null;
  first_channel: string;
  last_channel: string;
  device: string | null;
}

/** Compact attribution for staff. Omits fbclid, gclid, and the other click ids. */
export function orderMarketingSummary(order: {
  attribution_source?: string | null;
  attribution_platform?: string | null;
  attribution_json?: StoredNotesAttribution | null;
}): OrderMarketingSummary | null {
  const state = order.attribution_json || null;
  if (!state?.first_touch && !state?.last_touch && !order.attribution_source && !order.attribution_platform) return null;
  const last = state?.last_touch || null;
  const first = state?.first_touch || null;
  const touch = last || first;
  const fromTouch = businessChannel(touch);
  return {
    channel: fromTouch !== "Unknown" ? fromTouch : order.attribution_platform || order.attribution_source || "Unknown",
    source: touch?.source || order.attribution_source || null,
    medium: touch?.medium || null,
    campaign: touch?.campaign || null,
    content: touch?.content || null,
    landing_page: touch?.landing_path || null,
    first_channel: businessChannel(first),
    last_channel: businessChannel(last),
    device: state?.device_category || null,
  };
}

const PII_KEY = /phone|email|address|pincode|postal|otp|password|secret|token|upi|cvv|aadhaar|card_number/;

export function isAnalyticsPiiKey(key: string): boolean {
  const s = key.toLowerCase();
  if (s === "name" || s === "customer_name" || s === "full_name") return true;
  return PII_KEY.test(s);
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\b[6-9]\d{9}\b/;

/** Drop PII keys and values. Keeps product ids, prices, campaign fields. */
export function stripAnalyticsProps(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (isAnalyticsPiiKey(key)) continue;
    if (typeof value === "string") {
      if (EMAIL.test(value) || PHONE.test(value)) continue;
      out[key] = value.slice(0, 180);
    } else if (typeof value === "number" || typeof value === "boolean" || value == null) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 12).map((item) =>
        item && typeof item === "object" ? stripAnalyticsProps(item as Record<string, unknown>) : item,
      );
    } else if (typeof value === "object") {
      out[key] = stripAnalyticsProps(value as Record<string, unknown>);
    }
  }
  return out;
}

const EXTERNAL: Record<string, { ga4: string; meta?: "ViewContent" | "AddToCart" | "InitiateCheckout" }> = {
  notes_store_viewed: { ga4: "view_item_list" },
  notes_product_clicked: { ga4: "select_item" },
  notes_product_viewed: { ga4: "view_item", meta: "ViewContent" },
  notes_bundle_viewed: { ga4: "view_item", meta: "ViewContent" },
  notes_added_to_cart: { ga4: "add_to_cart", meta: "AddToCart" },
  notes_cart_viewed: { ga4: "view_cart" },
  notes_checkout_started: { ga4: "begin_checkout", meta: "InitiateCheckout" },
  notes_payment_gateway_opened: { ga4: "add_payment_info" },
};

/** GA4 ecommerce + Meta browser event for a Notes beacon. Purchase is server-only. */
export function externalNotesDispatch(event: string, props: Record<string, unknown>): {
  ga4: { name: string; params: Record<string, unknown> } | null;
  meta: { name: "ViewContent" | "AddToCart" | "InitiateCheckout"; params: Record<string, unknown> } | null;
} {
  const spec = EXTERNAL[event];
  if (!spec) return { ga4: null, meta: null };
  const paise = typeof props.price_paise === "number" ? props.price_paise : typeof props.value_paise === "number" ? props.value_paise : null;
  const value = paise == null ? undefined : paise / 100;
  const itemId = props.product_id || props.slug;
  const params: Record<string, unknown> = { currency: "INR" };
  if (value != null) params.value = value;
  if (itemId) {
    params.items = [{
      item_id: String(itemId),
      item_name: String(props.subject || props.slug || "UPSC Notes"),
      quantity: typeof props.quantity === "number" ? props.quantity : 1,
      ...(value != null ? { price: value } : {}),
    }];
  }
  return {
    ga4: { name: spec.ga4, params },
    meta: spec.meta ? { name: spec.meta, params } : null,
  };
}

export function notesPurchaseDedupeKey(orderId: string): string {
  return `notes_purchase:${orderId}`;
}

export function notesPaymentInitDedupeKey(orderId: string): string {
  return `notes_payment_initiated:${orderId}`;
}

export function notesPaymentFailDedupeKey(orderId: string, outcome: string): string {
  return `notes_payment_failed:${orderId}:${outcome}`;
}

const DEST: Record<string, string> = {
  store: "/notes",
  polity: "/notes/polity",
  economy: "/notes/economy",
};

export function buildNotesCampaignUrl(input: {
  destination: "store" | "polity" | "economy";
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
}): string {
  const path = DEST[input.destination] || "/notes";
  const url = new URL(path, CAMPAIGN_HOST);
  const set = (key: string, value?: string) => {
    const next = (value || "").trim().toLowerCase().replace(/\s+/g, "_");
    if (next) url.searchParams.set(key, next);
  };
  set("utm_source", input.source);
  set("utm_medium", input.medium);
  set("utm_campaign", input.campaign);
  set("utm_content", input.content);
  set("utm_term", input.term);
  return url.toString();
}

export const CAMPAIGN_TEMPLATES = [
  { id: "story_polity", label: "Instagram Story → Polity", destination: "polity" as const, source: "instagram", medium: "story", content: "polity_story_01" },
  { id: "story_economy", label: "Instagram Story → Economy", destination: "economy" as const, source: "instagram", medium: "story", content: "economy_story_01" },
  { id: "autodm", label: "Instagram Auto-DM → Notes Store", destination: "store" as const, source: "instagram", medium: "autodm", content: "notes_dm" },
  { id: "whatsapp", label: "WhatsApp → Notes Store", destination: "store" as const, source: "whatsapp", medium: "message", content: "" },
  { id: "telegram", label: "Telegram → Economy", destination: "economy" as const, source: "telegram", medium: "community", content: "" },
  { id: "youtube", label: "YouTube → Notes Store", destination: "store" as const, source: "youtube", medium: "organic", content: "" },
  { id: "meta", label: "Meta Ad → Notes Store", destination: "store" as const, source: "meta", medium: "paid_social", content: "" },
  { id: "google", label: "Google Ad → Notes Store", destination: "store" as const, source: "google", medium: "cpc", content: "" },
];

export interface NotesEventRow {
  event_name: string;
  session_id?: string | null;
  visitor_id?: string | null;
  occurred_at: string;
  page_path?: string | null;
  device?: { type?: string; os?: string; browser?: string } | null;
  attribution?: AttributionState | null;
  props?: Record<string, unknown> | null;
}

export interface NotesOrderFact {
  id: string;
  status: string;
  total_paise: number;
  discount_paise?: number | null;
  paid_at: string | null;
  promo_code?: string | null;
  attribution_source?: string | null;
  attribution_platform?: string | null;
  attribution_json?: StoredNotesAttribution | null;
  /** Used only to count distinct buyers. Never rendered. */
  phone_key?: string | null;
  shipping_address_id?: string | null;
}

export interface NotesItemFact {
  order_id: string;
  product_id?: string | null;
  name_snapshot: string;
  sku_snapshot?: string | null;
  line_total_paise: number;
  qty?: number | null;
}

const UNPAID = new Set(["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"]);

export function orderIsCaptured(order: NotesOrderFact): boolean {
  if (!order.paid_at) return false;
  return !UNPAID.has(order.status);
}

/** Paid orders that belong in business charts. QA and unpaid rows stay out. */
export function notesBusinessOrders(orders: NotesOrderFact[]): NotesOrderFact[] {
  return orders.filter((order) => orderIsCaptured(order) && !orderQa(order));
}

/** First-party events that belong in behavior charts. QA rows stay out. */
export function notesBusinessEvents(events: NotesEventRow[]): NotesEventRow[] {
  return events.filter((event) => !eventQa(event));
}

function touchOf(state: AttributionState | null | undefined): AttributionTouch | null {
  return state?.last_touch || state?.first_touch || null;
}

function eventQa(event: NotesEventRow): boolean {
  if (event.props?.is_test === true) return true;
  return isQaState(event.attribution);
}

function orderQa(order: NotesOrderFact): boolean {
  if (isQaState(order.attribution_json)) return true;
  const source = clean(order.attribution_source);
  return source === "qa" || clean(order.promo_code) === NOTES_QA_CAMPAIGN;
}

function actor(event: NotesEventRow, index: number): string {
  return event.session_id || event.visitor_id || `anon:${index}`;
}

function people(events: NotesEventRow[], names: Set<string>): number {
  const ids = new Set<string>();
  events.forEach((event, index) => {
    if (names.has(event.event_name)) ids.add(actor(event, index));
  });
  return ids.size;
}

function subjectOf(props: Record<string, unknown> | null | undefined): string {
  const raw = String(props?.subject || props?.slug || "").toLowerCase();
  if (raw.includes("polit")) return "polity";
  if (raw.includes("econom")) return "economy";
  return raw;
}

function productKey(props: Record<string, unknown> | null | undefined): string {
  return String(props?.product_id || props?.slug || props?.subject || "unknown");
}

function productLabel(props: Record<string, unknown> | null | undefined): string {
  const subject = subjectOf(props);
  if (subject === "polity") return "Indian Polity Notes";
  if (subject === "economy") return "Indian Economy Notes";
  return String(props?.product_name || props?.slug || props?.subject || props?.product_id || "Notes");
}

export interface NotesAnalyticsReport {
  kpis: {
    visitors: number;
    productViewers: number;
    addToCarts: number;
    checkouts: number;
    paymentAttempts: number;
    paidOrders: number;
    conversionPct: number | null;
    revenuePaise: number;
    aovPaise: number | null;
  };
  funnel: Array<{ id: string; label: string; people: number; fromPrevPct: number | null; dropPct: number | null }>;
  largestDrop: { label: string; dropPct: number } | null;
  products: Array<{
    key: string;
    label: string;
    views: number;
    pdfPeople: number;
    videoStarts: number;
    addToCarts: number;
    orders: number;
    revenuePaise: number;
    conversionPct: number | null;
  }>;
  sources: Array<{ channel: string; visitors: number; checkouts: number; paid: number; revenuePaise: number; conversionPct: number | null }>;
  campaigns: Array<{ campaign: string; content: string; visitors: number; paid: number; revenuePaise: number; conversionPct: number | null }>;
  landings: Array<{ path: string; sessions: number; productClicks: number; checkouts: number; purchases: number }>;
  content: { pdfPeople: number; videoStarts: number; video50: number; videoCompletes: number };
  ctas: Array<{ id: string; events: number; people: number }>;
  subjects: { polity: { clicks: number; people: number }; economy: { clicks: number; people: number } };
  devices: Array<{ device: string; sessions: number; checkouts: number; purchases: number }>;
  checkoutHealth: {
    starts: number;
    paymentAttempts: number;
    paid: number;
    failedPayments: number;
    validationErrors: number;
    shippingErrors: number;
    apiErrors: number;
    topErrors: Array<{ key: string; count: number }>;
    browsers: Array<{ browser: string; errors: number }>;
  };
  promotions: Array<{ code: string; orders: number; revenuePaise: number }>;
  revenueByDay: Array<{ day: string; revenuePaise: number; orders: number }>;
  excludedTestEvents: number;
}

function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function channelOfOrder(order: NotesOrderFact): string {
  const fromTouch = businessChannel(touchOf(order.attribution_json));
  if (fromTouch !== "Unknown") return fromTouch;
  return order.attribution_platform || order.attribution_source || "Unknown";
}

function campaignOf(state: AttributionState | null | undefined): { campaign: string; content: string } {
  const touch = touchOf(state);
  return {
    campaign: touch?.campaign || "(none)",
    content: touch?.content || "(none)",
  };
}

export function aggregateNotesAnalytics(eventsIn: NotesEventRow[], ordersIn: NotesOrderFact[], itemsIn: NotesItemFact[] = []): NotesAnalyticsReport {
  const excludedTestEvents = eventsIn.filter(eventQa).length;
  const events = eventsIn.filter((event) => !eventQa(event));
  const orders = ordersIn.filter((order) => orderIsCaptured(order) && !orderQa(order));
  const paidIds = new Set(orders.map((order) => order.id));
  const items = itemsIn.filter((item) => paidIds.has(item.order_id));

  const store = new Set(["notes_store_viewed"]);
  const product = new Set(["notes_product_viewed", "notes_bundle_viewed"]);
  const cart = new Set(["notes_added_to_cart"]);
  const checkout = new Set(["notes_checkout_started"]);
  const payment = new Set(["notes_payment_initiated"]);
  const visitors = people(events, store);
  const productViewers = people(events, product);
  const addToCarts = people(events, cart);
  const checkouts = people(events, checkout);
  const paymentAttempts = people(events, payment);
  const paidOrders = orders.length;
  const revenuePaise = orders.reduce((sum, order) => sum + (order.total_paise || 0), 0);

  const stages = [
    { id: "visitors", label: "Notes Store visitors", people: visitors },
    { id: "product", label: "Product viewed", people: productViewers },
    { id: "cart", label: "Add to cart", people: addToCarts },
    { id: "checkout", label: "Checkout started", people: checkouts },
    { id: "payment", label: "Payment initiated", people: paymentAttempts },
    { id: "paid", label: "Paid", people: paidOrders },
  ];
  const funnel = stages.map((stage, index) => {
    const prev = index === 0 ? null : stages[index - 1].people;
    const fromPrevPct = prev == null ? null : pct(stage.people, prev);
    const dropPct = fromPrevPct == null ? null : Math.round((100 - fromPrevPct) * 10) / 10;
    return { ...stage, fromPrevPct, dropPct };
  });
  let largestDrop: NotesAnalyticsReport["largestDrop"] = null;
  for (let i = 1; i < funnel.length; i++) {
    const drop = funnel[i].dropPct;
    if (drop == null || funnel[i - 1].people === 0) continue;
    if (!largestDrop || drop > largestDrop.dropPct) {
      largestDrop = { label: `${funnel[i - 1].label} → ${funnel[i].label}`, dropPct: drop };
    }
  }

  const pdf = new Set(["notes_sample_opened"]);
  const videoStart = new Set(["notes_physical_video_play", "notes_teaching_preview_started"]);
  const video50 = new Set(["notes_physical_video_50", "notes_teaching_video_50"]);
  const videoDone = new Set(["notes_physical_video_completed", "notes_teaching_video_completed"]);

  const productMap = new Map<string, NotesAnalyticsReport["products"][number]>();
  const ensureProduct = (key: string, label: string) => {
    const found = productMap.get(key);
    if (found) return found;
    const row = { key, label, views: 0, pdfPeople: 0, videoStarts: 0, addToCarts: 0, orders: 0, revenuePaise: 0, conversionPct: null };
    productMap.set(key, row);
    return row;
  };
  const seen = new Set<string>();
  events.forEach((event, index) => {
    const key = productKey(event.props);
    if (key === "unknown" && !product.has(event.event_name) && !pdf.has(event.event_name) && !videoStart.has(event.event_name) && !cart.has(event.event_name)) return;
    const id = `${event.event_name}:${actor(event, index)}:${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    const row = ensureProduct(key, productLabel(event.props));
    if (product.has(event.event_name)) row.views += 1;
    if (pdf.has(event.event_name)) row.pdfPeople += 1;
    if (videoStart.has(event.event_name)) row.videoStarts += 1;
    if (cart.has(event.event_name)) row.addToCarts += 1;
  });
  for (const item of items) {
    const key = item.product_id || item.sku_snapshot || item.name_snapshot;
    const row = ensureProduct(key, item.name_snapshot || "Notes");
    row.orders += 1;
    row.revenuePaise += item.line_total_paise || 0;
  }
  const products = [...productMap.values()].map((row) => ({
    ...row,
    conversionPct: pct(row.orders, row.views),
  })).sort((a, b) => b.revenuePaise - a.revenuePaise || b.views - a.views);

  const sourceVisitors = new Map<string, Set<string>>();
  const sourceCheckouts = new Map<string, Set<string>>();
  events.forEach((event, index) => {
    const channel = businessChannel(touchOf(event.attribution));
    const id = actor(event, index);
    if (store.has(event.event_name)) {
      if (!sourceVisitors.has(channel)) sourceVisitors.set(channel, new Set());
      sourceVisitors.get(channel)!.add(id);
    }
    if (checkout.has(event.event_name)) {
      if (!sourceCheckouts.has(channel)) sourceCheckouts.set(channel, new Set());
      sourceCheckouts.get(channel)!.add(id);
    }
  });
  const sourcePaid = new Map<string, { paid: number; revenuePaise: number }>();
  for (const order of orders) {
    const channel = channelOfOrder(order);
    const row = sourcePaid.get(channel) || { paid: 0, revenuePaise: 0 };
    row.paid += 1;
    row.revenuePaise += order.total_paise || 0;
    sourcePaid.set(channel, row);
  }
  const sourceKeys = new Set([...sourceVisitors.keys(), ...sourceCheckouts.keys(), ...sourcePaid.keys()]);
  const sources = [...sourceKeys].map((channel) => {
    const visitorsN = sourceVisitors.get(channel)?.size || 0;
    const paid = sourcePaid.get(channel)?.paid || 0;
    return {
      channel,
      visitors: visitorsN,
      checkouts: sourceCheckouts.get(channel)?.size || 0,
      paid,
      revenuePaise: sourcePaid.get(channel)?.revenuePaise || 0,
      conversionPct: pct(paid, visitorsN),
    };
  }).sort((a, b) => b.revenuePaise - a.revenuePaise || b.visitors - a.visitors);

  const campVisitors = new Map<string, Set<string>>();
  events.forEach((event, index) => {
    if (!store.has(event.event_name)) return;
    const c = campaignOf(event.attribution);
    const key = `${c.campaign}\u0000${c.content}`;
    if (!campVisitors.has(key)) campVisitors.set(key, new Set());
    campVisitors.get(key)!.add(actor(event, index));
  });
  const campPaid = new Map<string, { paid: number; revenuePaise: number }>();
  for (const order of orders) {
    const c = campaignOf(order.attribution_json);
    const key = `${c.campaign}\u0000${c.content}`;
    const row = campPaid.get(key) || { paid: 0, revenuePaise: 0 };
    row.paid += 1;
    row.revenuePaise += order.total_paise || 0;
    campPaid.set(key, row);
  }
  const campaigns = [...new Set([...campVisitors.keys(), ...campPaid.keys()])].map((key) => {
    const [campaign, content] = key.split("\u0000");
    const visitorsN = campVisitors.get(key)?.size || 0;
    const paid = campPaid.get(key)?.paid || 0;
    return { campaign, content, visitors: visitorsN, paid, revenuePaise: campPaid.get(key)?.revenuePaise || 0, conversionPct: pct(paid, visitorsN) };
  }).filter((row) => row.campaign !== "(none)" || row.paid > 0).sort((a, b) => b.revenuePaise - a.revenuePaise || b.visitors - a.visitors);

  const landingSessions = new Map<string, Set<string>>();
  const landingClicks = new Map<string, Set<string>>();
  const landingChecks = new Map<string, Set<string>>();
  events.forEach((event, index) => {
    const path = touchOf(event.attribution)?.landing_path || event.page_path || "(unknown)";
    const id = actor(event, index);
    if (store.has(event.event_name) || product.has(event.event_name)) {
      if (!landingSessions.has(path)) landingSessions.set(path, new Set());
      landingSessions.get(path)!.add(id);
    }
    if (event.event_name === "notes_product_clicked") {
      if (!landingClicks.has(path)) landingClicks.set(path, new Set());
      landingClicks.get(path)!.add(id);
    }
    if (checkout.has(event.event_name)) {
      if (!landingChecks.has(path)) landingChecks.set(path, new Set());
      landingChecks.get(path)!.add(id);
    }
  });
  const landingPurchases = new Map<string, number>();
  for (const order of orders) {
    const path = touchOf(order.attribution_json)?.landing_path || "(unknown)";
    landingPurchases.set(path, (landingPurchases.get(path) || 0) + 1);
  }
  const landings = [...new Set([...landingSessions.keys(), ...landingPurchases.keys()])].map((path) => ({
    path,
    sessions: landingSessions.get(path)?.size || 0,
    productClicks: landingClicks.get(path)?.size || 0,
    checkouts: landingChecks.get(path)?.size || 0,
    purchases: landingPurchases.get(path) || 0,
  })).sort((a, b) => b.sessions - a.sessions);

  const ctaMap = new Map<string, { events: number; people: Set<string> }>();
  const subject = {
    polity: { clicks: 0, people: new Set<string>() },
    economy: { clicks: 0, people: new Set<string>() },
  };
  events.forEach((event, index) => {
    if (event.event_name !== "notes_product_clicked" && event.event_name !== "notes_shop_after_teaching_clicked" && event.event_name !== "notes_added_to_cart" && event.event_name !== "notes_sample_opened" && event.event_name !== "notes_physical_video_play") return;
    const id = String(event.props?.cta_id || event.event_name);
    const row = ctaMap.get(id) || { events: 0, people: new Set<string>() };
    row.events += 1;
    row.people.add(actor(event, index));
    ctaMap.set(id, row);
    if (event.event_name === "notes_product_clicked") {
      const which = subjectOf(event.props);
      if (which === "polity" || which === "economy") {
        subject[which].clicks += 1;
        subject[which].people.add(actor(event, index));
      }
    }
  });

  const deviceMap = new Map<string, { sessions: Set<string>; checkouts: Set<string> }>();
  events.forEach((event, index) => {
    const device = event.device?.type || "unknown";
    const row = deviceMap.get(device) || { sessions: new Set<string>(), checkouts: new Set<string>() };
    if (store.has(event.event_name)) row.sessions.add(actor(event, index));
    if (checkout.has(event.event_name)) row.checkouts.add(actor(event, index));
    deviceMap.set(device, row);
  });
  const purchasesByDevice = new Map<string, number>();
  for (const order of orders) {
    const device = order.attribution_json?.device_category || "unknown";
    purchasesByDevice.set(device, (purchasesByDevice.get(device) || 0) + 1);
  }
  const devices = [...new Set([...deviceMap.keys(), ...purchasesByDevice.keys()])].map((device) => ({
    device,
    sessions: deviceMap.get(device)?.sessions.size || 0,
    checkouts: deviceMap.get(device)?.checkouts.size || 0,
    purchases: purchasesByDevice.get(device) || 0,
  })).sort((a, b) => b.purchases - a.purchases || b.sessions - a.sessions);

  const errorCounts = new Map<string, number>();
  const browsers = new Map<string, number>();
  let validationErrors = 0;
  let shippingErrors = 0;
  let apiErrors = 0;
  let failedPayments = 0;
  events.forEach((event) => {
    if (event.event_name === "notes_checkout_validation_error") validationErrors += 1;
    if (event.event_name === "notes_shipping_quote_error") shippingErrors += 1;
    if (event.event_name === "notes_checkout_api_error") apiErrors += 1;
    if (event.event_name === "notes_payment_failed") failedPayments += 1;
    if (!event.event_name.includes("error") && event.event_name !== "notes_payment_failed") return;
    const key = String(event.props?.reason || event.props?.field || event.props?.stage || event.props?.outcome || event.event_name);
    errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    const browser = [event.device?.browser, event.device?.os].filter(Boolean).join(" ") || "unknown";
    browsers.set(browser, (browsers.get(browser) || 0) + 1);
  });

  const promos = new Map<string, { orders: number; revenuePaise: number }>();
  const days = new Map<string, { revenuePaise: number; orders: number }>();
  for (const order of orders) {
    const code = order.promo_code || "(none)";
    const promo = promos.get(code) || { orders: 0, revenuePaise: 0 };
    promo.orders += 1;
    promo.revenuePaise += order.total_paise || 0;
    promos.set(code, promo);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(order.paid_at || 0));
    const bucket = days.get(day) || { revenuePaise: 0, orders: 0 };
    bucket.orders += 1;
    bucket.revenuePaise += order.total_paise || 0;
    days.set(day, bucket);
  }

  return {
    kpis: {
      visitors,
      productViewers,
      addToCarts,
      checkouts,
      paymentAttempts,
      paidOrders,
      conversionPct: pct(paidOrders, visitors),
      revenuePaise,
      aovPaise: paidOrders ? Math.round(revenuePaise / paidOrders) : null,
    },
    funnel,
    largestDrop,
    products,
    sources,
    campaigns,
    landings,
    content: {
      pdfPeople: people(events, pdf),
      videoStarts: people(events, videoStart),
      video50: people(events, video50),
      videoCompletes: people(events, videoDone),
    },
    ctas: [...ctaMap.entries()].map(([id, row]) => ({ id, events: row.events, people: row.people.size })).sort((a, b) => b.events - a.events),
    subjects: {
      polity: { clicks: subject.polity.clicks, people: subject.polity.people.size },
      economy: { clicks: subject.economy.clicks, people: subject.economy.people.size },
    },
    devices,
    checkoutHealth: {
      starts: checkouts,
      paymentAttempts,
      paid: paidOrders,
      failedPayments,
      validationErrors,
      shippingErrors,
      apiErrors,
      topErrors: [...errorCounts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      browsers: [...browsers.entries()].map(([browser, errors]) => ({ browser, errors })).sort((a, b) => b.errors - a.errors).slice(0, 8),
    },
    promotions: [...promos.entries()].map(([code, row]) => ({ code, ...row })).sort((a, b) => b.revenuePaise - a.revenuePaise),
    revenueByDay: [...days.entries()].map(([day, row]) => ({ day, ...row })).sort((a, b) => a.day.localeCompare(b.day)),
    excludedTestEvents,
  };
}

export type NotesRangeKey = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

export function notesRangeBounds(key: NotesRangeKey, now = new Date(), custom?: { from?: string; to?: string }): { start: Date; end: Date; label: string } {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const startOf = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
  const addDays = (iso: string, days: number) => {
    const base = startOf(iso);
    return new Date(base.getTime() + days * 86400000);
  };
  if (key === "today") return { start: startOf(day), end: addDays(day, 1), label: "Today" };
  if (key === "yesterday") return { start: addDays(day, -1), end: startOf(day), label: "Yesterday" };
  if (key === "30d") return { start: addDays(day, -29), end: addDays(day, 1), label: "Last 30 days" };
  if (key === "month") {
    const monthStart = `${day.slice(0, 8)}01`;
    return { start: startOf(monthStart), end: addDays(day, 1), label: "This month" };
  }
  if (key === "custom" && custom?.from && custom?.to) {
    return { start: startOf(custom.from), end: addDays(custom.to, 1), label: `${custom.from} – ${custom.to}` };
  }
  return { start: addDays(day, -6), end: addDays(day, 1), label: "Last 7 days" };
}
