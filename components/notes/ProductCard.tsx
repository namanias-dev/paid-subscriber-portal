import Link from "next/link";
import Image from "next/image";
import { BookOpen } from "lucide-react";
import { formatPaise, discountPercent } from "@/lib/store/money";
import type { StoreProductCard } from "@/lib/store/catalogue";

/** Notes catalogue card — mirrors CourseCard depth/gold language without course-specific fields. */
export default function ProductCard({ product }: { product: StoreProductCard }) {
  const pct = discountPercent(product.mrp_paise, product.selling_price_paise);
  const oos = product.sellable < 1;
  const category = product.category_name || product.subject || "Notes";

  return (
    <Link href={`/notes/products/${product.slug}`} className="ca-focus group block h-full">
      <article className="relative h-full rounded-2xl bg-gradient-to-b from-white/70 via-[var(--ca-slate-200)] to-[rgba(212,175,55,0.45)] p-px shadow-[0_1px_2px_rgba(10,26,63,0.05),0_18px_40px_-26px_rgba(10,26,63,0.30)] transition-all duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_1px_2px_rgba(10,26,63,0.06),0_30px_60px_-24px_rgba(212,175,55,0.42)] motion-reduce:transform-none motion-reduce:transition-none">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[15px] bg-white">
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)]">
            {product.cover_url ? (
              <Image
                src={product.cover_url}
                alt={product.name}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
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
              <span className="inline-flex items-center rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[var(--ca-navy-900)] shadow-sm backdrop-blur-sm">
                {category}
              </span>
              {oos ? (
                <span className="inline-flex items-center rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[var(--ca-slate-700)] shadow-sm">
                  Out of stock
                </span>
              ) : pct > 0 ? (
                <span className="inline-flex items-center rounded-full bg-[rgba(212,175,55,0.95)] px-2.5 py-1 text-[11px] font-extrabold text-[#1a1304] shadow-sm">
                  {pct}% OFF
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-1 flex-col p-4">
            <h3 className="line-clamp-2 font-heading text-base font-semibold leading-snug text-[var(--ca-navy)]">{product.name}</h3>
            <div className="mt-auto flex items-baseline gap-2 pt-3">
              <span className="text-lg font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(product.selling_price_paise)}</span>
              {pct > 0 && (
                <span className="text-sm tabular-nums text-[var(--ca-navy)]/40 line-through">{formatPaise(product.mrp_paise)}</span>
              )}
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
