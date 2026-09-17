import Link from "next/link";
import { formatPaise, discountPercent } from "@/lib/store/money";
import type { StoreProductCard } from "@/lib/store/catalogue";

export default function ProductCard({ product }: { product: StoreProductCard }) {
  const pct = discountPercent(product.mrp_paise, product.selling_price_paise);
  return (
    <Link
      href={`/notes/products/${product.slug}`}
      className="group block overflow-hidden rounded-2xl border border-[var(--ca-navy)]/10 bg-white transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(11,27,58,0.08)] motion-reduce:transform-none"
    >
      <div className="aspect-[4/3] bg-[var(--ca-slate-100,#eef1f6)]">
        {product.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.cover_url} alt="" className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03] motion-reduce:transform-none" />
        ) : (
          <div className="flex h-full items-end p-5 font-heading text-lg font-semibold text-[var(--ca-navy)]/40">{product.short_name || product.name}</div>
        )}
      </div>
      <div className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark,#9a7b2f)]">
          {product.category_name || product.subject || "Notes"}
        </p>
        <h3 className="mt-1 font-heading text-base font-semibold leading-snug text-[var(--ca-navy)]">{product.name}</h3>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-lg font-semibold text-[var(--ca-navy)]">{formatPaise(product.selling_price_paise)}</span>
          {pct > 0 && (
            <>
              <span className="text-sm text-[var(--ca-navy)]/40 line-through">{formatPaise(product.mrp_paise)}</span>
              <span className="text-xs font-semibold text-[var(--ca-gold-dark,#9a7b2f)]">{pct}% off</span>
            </>
          )}
        </div>
        {product.sellable < 1 && <p className="mt-2 text-xs text-[var(--ca-navy)]/50">Currently out of stock</p>}
      </div>
    </Link>
  );
}
