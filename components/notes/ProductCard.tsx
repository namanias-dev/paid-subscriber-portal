import Link from "next/link";
import Image from "next/image";
import { BookOpen } from "lucide-react";
import { formatPaise } from "@/lib/store/money";
import { calculateStorePrice, offerDiscountLabel, type OfferForPricing } from "@/lib/store/pricing";
import type { StoreProductCard } from "@/lib/store/catalogue";
import { notesProductPath } from "@/lib/store/paths";

/** Canonical Notes catalogue card — one language for landing, subjects, related. */
export default function ProductCard({
  product,
  featured = false,
  offer = null,
}: {
  product: StoreProductCard;
  featured?: boolean;
  offer?: OfferForPricing | null;
}) {
  const av = product.availability;
  const category = product.category_name || product.subject || "Notes";
  const priced = av.purchasable
    ? calculateStorePrice(
        {
          id: product.id,
          kind: product.kind,
          category_id: product.category_id,
          selling_price_paise: product.selling_price_paise,
        },
        1,
        offer,
      )
    : null;
  const badge =
    priced && priced.discount_paise > 0 && offer
      ? offer.badge_text || offerDiscountLabel(offer)
      : av.lowStock
        ? av.label
        : av.mode === "on_demand" && av.purchasable
          ? "Made to order"
          : null;

  return (
    <article className={`ns-product-card ${featured ? "lg:min-h-full" : ""}`}>
      <Link href={notesProductPath(product.slug)} className="ca-focus ns-product-card-link group block h-full">
        <div className={`relative overflow-hidden bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)] ${featured ? "aspect-[16/10] lg:aspect-[4/3]" : "aspect-[4/3]"}`}>
          {product.cover_url ? (
            <Image
              src={product.cover_url}
              alt={product.name}
              fill
              sizes={featured ? "(max-width: 1024px) 100vw, 50vw" : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"}
              className="object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transform-none"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-5 text-center">
              <BookOpen size={28} strokeWidth={1.5} className="text-[var(--ca-gold-bright)] opacity-90" aria-hidden="true" />
              <p className="line-clamp-2 font-heading text-sm font-bold text-white/90">{product.short_name || product.name}</p>
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-black/10" aria-hidden="true" />
          <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
            <span className="inline-flex items-center rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[var(--ca-navy-900)]">
              {category}
            </span>
            {badge && <span className="ns-product-offer-badge">{badge}</span>}
          </div>
        </div>
        <div className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">
            {product.kind === "bundle" ? "Bundle" : "Notes"}
          </p>
          <h3 className={`mt-1 font-heading font-semibold leading-snug text-[var(--ca-navy)] ${featured ? "text-xl" : "line-clamp-2 text-base"}`}>
            {product.name}
          </h3>
          {av.purchasable && priced ? (
            <div className="mt-3">
              <p className="font-heading text-[1.5rem] font-extrabold leading-none tabular-nums text-[var(--ca-navy)]">
                {formatPaise(priced.final_paise)}
              </p>
              {priced.discount_paise > 0 ? (
                <p className="mt-1 text-[12px] text-[var(--ca-navy)]/55">
                  <span className="tabular-nums line-through">{formatPaise(priced.base_paise)}</span>
                  <span className="sr-only"> regular price </span>
                  <span className="ml-1 font-bold text-[var(--ca-gold-dark)]">Save {formatPaise(priced.discount_paise)}</span>
                </p>
              ) : (
                <p className="mt-1 text-[12px] text-[var(--ca-navy)]/45">incl. GST</p>
              )}
              <span className="ns-card-cta mt-3">View notes</span>
            </div>
          ) : (
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="text-[13px] font-semibold text-[var(--ca-navy)]/50">Currently unavailable</p>
              <p className="text-[13px] font-bold text-[var(--ca-navy)]">View →</p>
            </div>
          )}
        </div>
      </Link>
    </article>
  );
}
