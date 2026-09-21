import Link from "next/link";
import type { StoreCategory, StoreProductCard } from "@/lib/store/catalogue";
import { formatPaise } from "@/lib/store/money";
import { calculateStorePrice, offerDiscountLabel, type OfferForPricing } from "@/lib/store/pricing";
import NotebookStack from "./NotebookStack";

export default function SubjectRail({
  categories,
  products,
  offer = null,
}: {
  categories: StoreCategory[];
  products: StoreProductCard[];
  offer?: OfferForPricing | null;
}) {
  if (!categories.length) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--ca-navy)]/15 bg-white px-6 py-12 text-center">
        <p className="font-heading text-lg font-semibold text-[var(--ca-navy)]">Subjects opening shortly</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ca-navy)]/55">
          Live titles will appear here once the Academy activates them.
        </p>
      </div>
    );
  }

  const byCategory = new Map<string, StoreProductCard[]>();
  for (const p of products) {
    if (!p.category_slug) continue;
    const list = byCategory.get(p.category_slug) || [];
    list.push(p);
    byCategory.set(p.category_slug, list);
  }

  return (
    <div className="relative">
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 ns-hide-scrollbar sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-4">
        {categories.map((c) => {
          const list = byCategory.get(c.slug) || [];
          const featured = list.find((p) => p.availability.purchasable) || list[0] || null;
          const available = !!featured?.availability.purchasable;
          const priced =
            featured && available
              ? calculateStorePrice(
                  {
                    id: featured.id,
                    kind: featured.kind,
                    category_id: featured.category_id,
                    selling_price_paise: featured.selling_price_paise,
                  },
                  1,
                  offer,
                )
              : null;
          const badge = priced && priced.discount_paise > 0 && offer ? offer.badge_text || offerDiscountLabel(offer) : null;

          return (
            <article key={c.slug} className="ns-product-card w-[82vw] max-w-[300px] shrink-0 snap-center sm:w-auto sm:max-w-none">
              <Link href={`/notes/${c.slug}`} className="ca-focus ns-product-card-link group block">
                <div className="flex items-start justify-between gap-3 px-4 pt-4">
                  <p className="ca-eyebrow text-[10px] text-[var(--ca-gold-dark)]">Subject</p>
                  {badge && <span className="ns-product-offer-badge">{badge}</span>}
                </div>
                <div className="px-4 pt-1">
                  <h3 className="font-heading text-[1.35rem] font-bold leading-tight text-[var(--ca-navy)]">
                    {c.nav_label || c.name}
                  </h3>
                  {c.short_description && (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--ca-navy)]/55">{c.short_description}</p>
                  )}
                </div>
                <div className="pointer-events-none px-7 py-4">
                  <NotebookStack
                    coverUrl={featured?.cover_url}
                    title={featured?.short_name || featured?.name}
                    subject={c.nav_label || c.name}
                  />
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
      <p className="mt-2 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ca-navy)]/32 sm:hidden">
        Swipe for more subjects
      </p>
    </div>
  );
}
