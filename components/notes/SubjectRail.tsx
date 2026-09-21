"use client";

import Link from "next/link";
import type { StoreProductCard } from "@/lib/store/catalogue";
import { formatPaise } from "@/lib/store/money";
import { calculateStorePrice, offerDiscountLabel, type OfferForPricing } from "@/lib/store/pricing";
import { notesProductPath } from "@/lib/store/paths";
import { trackClient } from "@/lib/analytics/client";
import NotebookStack from "./NotebookStack";

function cardTitle(product: StoreProductCard): string {
  return product.short_name || product.category_name || product.subject || product.name;
}

export default function SubjectRail({
  products,
  offer = null,
}: {
  products: StoreProductCard[];
  offer?: OfferForPricing | null;
}) {
  const items = products.filter((p) => p.kind === "single");
  if (!items.length) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--ca-navy)]/15 bg-white px-6 py-12 text-center">
        <p className="font-heading text-lg font-semibold text-[var(--ca-navy)]">Subjects opening shortly</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ca-navy)]/55">
          Live titles will appear here once the Academy activates them.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 ns-hide-scrollbar sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
        {items.map((product) => {
          const available = product.availability.purchasable;
          const priced = available
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
          const badge = priced && priced.discount_paise > 0 && offer ? offer.badge_text || offerDiscountLabel(offer) : null;
          const href = notesProductPath(product.slug);
          const title = cardTitle(product);

          return (
            <article key={product.id} className="ns-product-card w-[82vw] max-w-[300px] shrink-0 snap-center sm:w-auto sm:max-w-none">
              <Link
                href={href}
                className="ca-focus ns-product-card-link group block"
                onClick={() =>
                  trackClient("notes_product_clicked", {
                    product_id: product.id,
                    subject: product.category_slug || product.slug,
                    offer_id: priced?.offer_id,
                  })
                }
              >
                <div className="flex items-start justify-between gap-3 px-4 pt-4">
                  <p className="ca-eyebrow text-[10px] text-[var(--ca-gold-dark)]">Subject</p>
                  {badge && <span className="ns-product-offer-badge">{badge}</span>}
                </div>
                <div className="px-4 pt-1">
                  <h3 className="font-heading text-[1.35rem] font-bold leading-tight text-[var(--ca-navy)]">{title}</h3>
                  {product.short_description ? (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--ca-navy)]/55">
                      {product.short_description}
                    </p>
                  ) : null}
                </div>
                <div className="pointer-events-none px-7 py-4">
                  <NotebookStack title={title} subject={title} />
                </div>
                <div className="px-4 pb-4">
                  {available && priced ? (
                    <>
                      <p className="font-heading text-[1.65rem] font-extrabold leading-none tabular-nums text-[var(--ca-navy)]">
                        {formatPaise(priced.final_paise)}
                      </p>
                      {priced.discount_paise > 0 ? (
                        <p className="mt-1 text-[12px] text-[var(--ca-navy)]/45">
                          <span className="tabular-nums line-through">{formatPaise(priced.base_paise)}</span>
                          <span className="sr-only"> regular price </span>
                          <span aria-hidden="true"> · </span>
                          incl. GST
                        </p>
                      ) : (
                        <p className="mt-1 text-[12px] text-[var(--ca-navy)]/45">incl. GST</p>
                      )}
                      <p className="mt-3 text-[13px] font-bold text-[var(--ca-navy)]">View Notes →</p>
                    </>
                  ) : (
                    <div className="flex items-end justify-between gap-3">
                      <p className="text-[13px] font-semibold text-[var(--ca-navy)]/50">Currently unavailable</p>
                      <p className="text-[13px] font-bold text-[var(--ca-navy)]">View →</p>
                    </div>
                  )}
                </div>
              </Link>
            </article>
          );
        })}
      </div>
      {items.length > 1 && (
        <p className="mt-2 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ca-navy)]/32 sm:hidden">
          Swipe for more subjects
        </p>
      )}
    </div>
  );
}
