/**
 * Modern History first-50 launch merchandising.
 *
 * Price math still lives in calculateStorePrice. This file only names the
 * launch product/offer and the copy the storefront shows while the
 * server-authoritative allocation remains open.
 */
import { formatPaise } from "./money";
import { productEligibleForOffer, type OfferForPricing } from "./pricing";

export const MODERN_HISTORY_PRODUCT_ID = "c3a1e7d4-2b90-4f11-9c6a-0d8f2a1b7e55";
export const MODERN_HISTORY_SLUG = "modern-history";
export const MODERN_HISTORY_OFFER_SLUG = "modern-history-first-50";
export const MODERN_HISTORY_MRP_PAISE = 374_900;
export const MODERN_HISTORY_SELLING_PAISE = 299_900;
export const MODERN_HISTORY_LAUNCH_PAISE = 199_900;
export const MODERN_HISTORY_LAUNCH_DISCOUNT_PAISE = 100_000;
export const MODERN_HISTORY_LAUNCH_CAP = 50;

export const MODERN_HISTORY_SEO_TITLE =
  "Modern History Handwritten Notes for UPSC | Naman Sharma IAS Academy";
export const MODERN_HISTORY_SEO_DESCRIPTION =
  "Handwritten Modern History notes for UPSC CSE — chronology, movements and the freedom struggle, written for Prelims and Mains GS Paper I by Naman Sharma IAS Academy.";

export function isModernHistorySlug(slug: string | null | undefined): boolean {
  return (slug || "").trim().toLowerCase() === MODERN_HISTORY_SLUG;
}

export function isModernHistoryProduct(product: { id?: string | null; slug?: string | null }): boolean {
  return product.id === MODERN_HISTORY_PRODUCT_ID || isModernHistorySlug(product.slug);
}

export function isModernHistoryLaunchOffer(
  offer: { slug?: string | null; product_ids?: string[] | null } | null | undefined,
): boolean {
  if (!offer) return false;
  if ((offer.slug || "").trim().toLowerCase() === MODERN_HISTORY_OFFER_SLUG) return true;
  const ids = offer.product_ids || [];
  return ids.length === 1 && ids[0] === MODERN_HISTORY_PRODUCT_ID;
}

export function modernHistoryLaunchActive(
  product: { id: string; kind: "single" | "bundle"; category_id: string | null; selling_price_paise: number; slug?: string | null },
  offer: OfferForPricing | null | undefined,
  status?: string | null,
): boolean {
  if (!isModernHistoryProduct(product)) return false;
  if (!isModernHistoryLaunchOffer(offer)) return false;
  if (status && status !== "ACTIVE") return false;
  return productEligibleForOffer(product, offer);
}

export function modernHistoryLaunchBadge(): string {
  return "NEW RELEASE";
}

export function modernHistoryLaunchCaption(): string {
  return "Launch offer · First 50 paid orders";
}

export function modernHistoryLaunchPriceLabel(): string {
  return formatPaise(MODERN_HISTORY_LAUNCH_PAISE);
}

export function modernHistoryRegularPriceLabel(): string {
  return formatPaise(MODERN_HISTORY_SELLING_PAISE);
}
