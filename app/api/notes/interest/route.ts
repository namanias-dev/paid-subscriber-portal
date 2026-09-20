import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import {
  getOrCreateInterestVoterId,
  getInterestSnapshot,
  isInterestEligible,
  sanitizeInterestSource,
  submitInterest,
} from "@/lib/store/interest";
import { getProductById } from "@/lib/store/catalogue";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  const url = new URL(req.url);
  const productId = (url.searchParams.get("product_id") || "").trim();
  if (!UUID_RE.test(productId)) return noStoreJson({ ok: false, error: "product_id required" }, 400);
  const product = await getProductById(productId);
  if (!product) return noStoreJson({ ok: false, error: "This product is no longer available." }, 404);
  const voter = getOrCreateInterestVoterId();
  const snap = await getInterestSnapshot(product.id, voter.hash);
  return noStoreJson({
    ok: true,
    product_id: product.id,
    eligible: isInterestEligible(product.availability),
    availability_state: product.availability.state,
    recorded: snap?.recorded ?? false,
    count: snap?.count ?? 0,
  });
}

export async function POST(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  let body: { product_id?: string; source?: string } = {};
  try {
    body = (await req.json()) as { product_id?: string; source?: string };
  } catch {
    return noStoreJson({ ok: false, error: "Invalid request." }, 400);
  }
  const productId = String(body.product_id || "").trim();
  if (!UUID_RE.test(productId)) return noStoreJson({ ok: false, error: "product_id required" }, 400);
  const result = await submitInterest({
    productId,
    source: sanitizeInterestSource(body.source),
    req,
  });
  if (!result.ok) return noStoreJson({ ok: false, error: result.error }, result.status);
  return noStoreJson({
    ok: true,
    recorded: result.recorded,
    duplicate: result.duplicate,
    count: result.count,
    availability_state: result.availability_state,
  });
}
