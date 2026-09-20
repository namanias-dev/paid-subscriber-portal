import Link from "next/link";
import type { StoreCategory, StoreProductCard } from "@/lib/store/catalogue";
import { formatPaise } from "@/lib/store/money";
import InterestButton from "./InterestButton";
import NotebookStack from "./NotebookStack";

export default function SubjectRail({
  categories,
  products,
}: {
  categories: StoreCategory[];
  products: StoreProductCard[];
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
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 ns-hide-scrollbar sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-4">
        {categories.map((c) => {
          const list = byCategory.get(c.slug) || [];
          const featured = list.find((p) => p.availability.purchasable) || list[0] || null;
          const upcoming = list.find((p) => p.availability.state === "coming_soon" || p.availability.state === "unavailable");
          return (
            <article
              key={c.slug}
              className="ns-elev-2 w-[78vw] max-w-[280px] shrink-0 snap-start overflow-hidden rounded-3xl bg-white sm:w-auto sm:max-w-none"
            >
              <Link href={`/notes/${c.slug}`} className="ca-focus ns-lift group block">
                <div className="px-4 pt-4">
                  <p className="ca-eyebrow text-[10px] text-[var(--ca-gold-dark)]">Subject</p>
                  <h3 className="mt-1 font-heading text-lg font-bold text-[var(--ca-navy)]">{c.nav_label || c.name}</h3>
                  {c.short_description && <p className="mt-1 line-clamp-2 text-xs text-[var(--ca-navy)]/55">{c.short_description}</p>}
                </div>
                <div className="pointer-events-none px-6 py-4">
                  <NotebookStack coverUrl={featured?.cover_url} title={featured?.short_name || featured?.name} subject={c.nav_label || c.name} />
                </div>
                <div className="flex items-center justify-between px-4 pb-4">
                  <span className="text-xs font-semibold text-[var(--ca-navy)]/60">
                    {featured?.availability.purchasable
                      ? formatPaise(featured.selling_price_paise)
                      : upcoming
                        ? upcoming.availability.label
                        : list.length
                          ? featured?.availability.label
                          : "Opening soon"}
                  </span>
                  <span className="text-xs font-bold text-[var(--ca-navy)]">View →</span>
                </div>
              </Link>
              {upcoming && !featured?.availability.purchasable && (
                <div className="border-t border-[var(--ca-navy)]/8 px-4 py-3">
                  <InterestButton productId={upcoming.id} source="landing" compact />
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ca-navy)]/40 sm:hidden">
        Swipe for more subjects
      </p>
    </div>
  );
}
