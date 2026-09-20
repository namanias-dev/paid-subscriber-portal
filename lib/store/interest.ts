/**
 * Notes Store subject-interest (demand signal).
 *
 * This is not an order. Coming Soon / planned titles can collect an anonymous
 * "I want these notes" vote so the Academy can see potential demand separately
 * from paid preparation-queue demand.
 *
 * Isolation: store_* + auth_attempts (rate limit) + analytics_events only.
 * No academy identity, payments, or entitlement tables.
 */
import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { storeDb } from "./db";
import { getProductById } from "./catalogue";
import { clientIp, storeRateLimited } from "./rateLimit";
import type { AvailabilityView } from "./availability";

export const INTEREST_COOKIE = "nias_notes_interest";
export const INTEREST_SOURCES = ["landing", "subject", "pdp", "unknown"] as const;
export type InterestSource = (typeof INTEREST_SOURCES)[number];

export const INTEREST_IP_MAX = 12;
export const INTEREST_IP_WINDOW_SEC = 10 * 60;
export const INTEREST_VOTER_MAX = 24;
export const INTEREST_VOTER_WINDOW_SEC = 24 * 60 * 60;

const COOKIE_DAYS = 400;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isInterestSource(v: unknown): v is InterestSource {
  return typeof v === "string" && (INTEREST_SOURCES as readonly string[]).includes(v);
}

export function sanitizeInterestSource(v: unknown): InterestSource {
  return isInterestSource(v) ? v : "unknown";
}

export function hashInterestVoter(rawId: string): string {
  return createHash("sha256").update(`notes-interest:v1:${rawId}`).digest("hex");
}

export function isInterestEligible(availability: Pick<AvailabilityView, "state">): boolean {
  return availability.state === "coming_soon" || availability.state === "unavailable";
}

export function interestRateLimited(existing: number, max: number): boolean {
  return existing >= max;
}

export interface InterestAggregateRow {
  product_id: string;
  name: string;
  subject: string | null;
  slug: string;
  availability_mode: string;
  availability_label: string;
  total: number;
  last7: number;
  last30: number;
  last_at: string | null;
}

export function aggregateInterestRows(
  votes: Array<{ product_id: string; created_at: string }>,
  products: Map<
    string,
    { name: string; subject: string | null; slug: string; availability_mode: string; availability_label: string }
  >,
  nowMs = Date.now(),
): InterestAggregateRow[] {
  const day7 = nowMs - 7 * 24 * 60 * 60 * 1000;
  const day30 = nowMs - 30 * 24 * 60 * 60 * 1000;
  const byProduct = new Map<string, { total: number; last7: number; last30: number; last_at: string | null }>();
  for (const vote of votes) {
    const at = new Date(vote.created_at).getTime();
    const cur = byProduct.get(vote.product_id) || { total: 0, last7: 0, last30: 0, last_at: null };
    cur.total += 1;
    if (at >= day30) cur.last30 += 1;
    if (at >= day7) cur.last7 += 1;
    if (!cur.last_at || vote.created_at > cur.last_at) cur.last_at = vote.created_at;
    byProduct.set(vote.product_id, cur);
  }
  const rows: InterestAggregateRow[] = [];
  for (const [productId, stats] of byProduct) {
    const product = products.get(productId);
    if (!product) continue;
    rows.push({
      product_id: productId,
      name: product.name,
      subject: product.subject,
      slug: product.slug,
      availability_mode: product.availability_mode,
      availability_label: product.availability_label,
      ...stats,
    });
  }
  return rows;
}

export type InterestSort = "most" | "recent" | "coming_soon";

export function sortInterestRows(rows: InterestAggregateRow[], sort: InterestSort): InterestAggregateRow[] {
  const copy = [...rows];
  if (sort === "recent") {
    copy.sort((a, b) => (b.last_at || "").localeCompare(a.last_at || "") || b.total - a.total);
  } else if (sort === "coming_soon") {
    copy.sort((a, b) => {
      const aSoon = a.availability_mode === "coming_soon" ? 0 : 1;
      const bSoon = b.availability_mode === "coming_soon" ? 0 : 1;
      return aSoon - bSoon || b.total - a.total;
    });
  } else {
    copy.sort((a, b) => b.total - a.total || (b.last_at || "").localeCompare(a.last_at || ""));
  }
  return copy;
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_DAYS * 24 * 60 * 60,
  };
}

export function readInterestVoterId(): string | null {
  const raw = cookies().get(INTEREST_COOKIE)?.value || "";
  return UUID_RE.test(raw) ? raw : null;
}

export function writeInterestVoterId(id: string): void {
  cookies().set(INTEREST_COOKIE, id, cookieOpts());
}

export function getOrCreateInterestVoterId(): { id: string; hash: string } {
  const existing = readInterestVoterId();
  if (existing) return { id: existing, hash: hashInterestVoter(existing) };
  const id = randomUUID();
  writeInterestVoterId(id);
  return { id, hash: hashInterestVoter(id) };
}

export async function getInterestSnapshot(
  productId: string,
  voterHash?: string,
): Promise<{ count: number; recorded: boolean } | null> {
  const db = storeDb();
  if (!db) return null;
  const { count } = await db
    .from("store_subject_interest")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  let recorded = false;
  if (voterHash) {
    const { data } = await db
      .from("store_subject_interest")
      .select("id")
      .eq("product_id", productId)
      .eq("voter_hash", voterHash)
      .maybeSingle();
    recorded = !!data;
  }
  return { count: count ?? 0, recorded };
}

export type SubmitInterestResult =
  | { ok: true; recorded: true; duplicate: boolean; count: number; availability_state: string }
  | { ok: false; error: string; status: number };

export async function submitInterest(opts: {
  productId: string;
  source: unknown;
  req: Request;
}): Promise<SubmitInterestResult> {
  const product = await getProductById(opts.productId);
  if (!product) return { ok: false, error: "This product is no longer available.", status: 404 };
  if (!isInterestEligible(product.availability)) {
    return { ok: false, error: "Interest is only open for upcoming notes.", status: 400 };
  }

  const ip = clientIp(opts.req);
  if (await storeRateLimited(`notes_interest:ip:${ip}`, INTEREST_IP_MAX, INTEREST_IP_WINDOW_SEC)) {
    return { ok: false, error: "Too many requests. Please try again later.", status: 429 };
  }

  const voter = getOrCreateInterestVoterId();
  if (await storeRateLimited(`notes_interest:voter:${voter.hash}`, INTEREST_VOTER_MAX, INTEREST_VOTER_WINDOW_SEC)) {
    return { ok: false, error: "Too many requests. Please try again later.", status: 429 };
  }

  const db = storeDb();
  if (!db) return { ok: false, error: "Unable to record interest right now.", status: 503 };

  const existing = await getInterestSnapshot(product.id, voter.hash);
  if (existing?.recorded) {
    return {
      ok: true,
      recorded: true,
      duplicate: true,
      count: existing.count,
      availability_state: product.availability.state,
    };
  }

  const { error } = await db.from("store_subject_interest").insert({
    product_id: product.id,
    voter_hash: voter.hash,
    source: sanitizeInterestSource(opts.source),
  });
  if (error) {
    if (error.code === "23505") {
      const snap = await getInterestSnapshot(product.id, voter.hash);
      return {
        ok: true,
        recorded: true,
        duplicate: true,
        count: snap?.count ?? 1,
        availability_state: product.availability.state,
      };
    }
    return { ok: false, error: "Unable to record interest right now.", status: 500 };
  }

  const snap = await getInterestSnapshot(product.id, voter.hash);
  return {
    ok: true,
    recorded: true,
    duplicate: false,
    count: snap?.count ?? 1,
    availability_state: product.availability.state,
  };
}

export async function listInterestAggregates(sort: InterestSort = "most"): Promise<InterestAggregateRow[]> {
  const db = storeDb();
  if (!db) return [];
  const { data: votes } = await db.from("store_subject_interest").select("product_id,created_at");
  const productIds = [...new Set((votes || []).map((v) => v.product_id))];
  if (!productIds.length) return [];
  const { data: products } = await db
    .from("store_products")
    .select("id,name,subject,slug,availability_mode,is_active")
    .in("id", productIds);
  const map = new Map<
    string,
    { name: string; subject: string | null; slug: string; availability_mode: string; availability_label: string }
  >();
  for (const p of products || []) {
    map.set(p.id, {
      name: p.name,
      subject: p.subject,
      slug: p.slug,
      availability_mode: String(p.availability_mode || "ready_stock"),
      availability_label: p.is_active ? String(p.availability_mode || "ready_stock") : "draft",
    });
  }
  return sortInterestRows(aggregateInterestRows(votes || [], map), sort);
}
