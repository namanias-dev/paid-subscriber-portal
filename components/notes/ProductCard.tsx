import Link from "next/link";
import Image from "next/image";
import { BookOpen } from "lucide-react";
import { formatPaise, discountPercent } from "@/lib/store/money";
import type { StoreProductCard } from "@/lib/store/catalogue";
import InterestButton from "./InterestButton";

/** Canonical Notes catalogue card — one language for landing, subjects, related. */
export default function ProductCard({
  product,
  featured = false,
  interestSource = "landing",
}: {
  product: StoreProductCard;
  featured?: boolean;
  interestSource?: "landing" | "subject" | "pdp";
}) {
  const pct = discountPercent(product.mrp_paise, product.selling_price_paise);
  const av = product.availability;
  const category = product.category_name || product.subject || "Notes";
  const statusBadge = !av.purchasable
    ? { text: av.label, tone: "muted" as const }
    : av.lowStock
      ? { text: av.label, tone: "warn" as const }
      : pct > 0
        ? { text: `${pct}% OFF`, tone: "gold" as const }
        : av.mode === "on_demand"
          ? { text: "Made to order", tone: "muted" as const }
          : null;
  const showInterest = av.state === "coming_soon" || av.state === "unavailable";

  return (
    <article className={`group relative h-full overflow-hidden rounded-3xl bg-white ns-elev-2 ${featured ? "lg:min-h-full" : ""}`}>
      <Link href={`/notes/products/${product.slug}`} className="ca-focus ns-lift block h-full">
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
            {statusBadge && (
              <span
                className={
                  statusBadge.tone === "gold"
                    ? "inline-flex items-center rounded-full bg-[rgba(212,175,55,0.95)] px-2.5 py-1 text-[11px] font-extrabold text-[#1a1304]"
                    : statusBadge.tone === "warn"
                      ? "inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900"
                      : "inline-flex items-center rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[var(--ca-slate-700)]"
                }
              >
                {statusBadge.text}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">{product.kind === "bundle" ? "Bundle" : "Notes"}</p>
          <h3 className={`mt-1 font-heading font-semibold leading-snug text-[var(--ca-navy)] ${featured ? "text-xl" : "line-clamp-2 text-base"}`}>
            {product.name}
          </h3>
          <div className="mt-auto flex items-baseline gap-2 pt-3">
            <span className="text-lg font-semibold tabular-nums text-[var(--ca-navy)]">{formatPaise(product.selling_price_paise)}</span>
            {pct > 0 && <span className="text-sm tabular-nums text-[var(--ca-navy)]/40 line-through">{formatPaise(product.mrp_paise)}</span>}
          </div>
        </div>
      </Link>
      {showInterest && (
        <div className="border-t border-[var(--ca-navy)]/8 px-4 py-3">
          <InterestButton productId={product.id} source={interestSource} compact />
        </div>
      )}
    </article>
  );
}
