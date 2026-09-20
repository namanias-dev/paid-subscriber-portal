import Link from "next/link";
import { formatPaise, discountPercent } from "@/lib/store/money";
import type { StoreProductCard, StoreProductDetail } from "@/lib/store/catalogue";
import NotebookStack from "./NotebookStack";

export default function BundleShowcase({
  bundles,
  details,
}: {
  bundles: StoreProductCard[];
  details: StoreProductDetail[];
}) {
  if (!bundles.length) {
    return (
      <div className="rounded-3xl bg-[var(--ca-navy)] px-6 py-10 text-white sm:px-10">
        <p className="ca-eyebrow">Bundles</p>
        <h2 className="mt-2 font-heading text-3xl font-bold">Complete sets, when they are listed</h2>
        <p className="mt-3 max-w-xl text-white/70">Bundle products appear here from the catalogue. Until then, shop by subject.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {bundles.map((b) => {
        const detail = details.find((d) => d.id === b.id);
        const save =
          detail && detail.components_total_paise > b.selling_price_paise
            ? detail.components_total_paise - b.selling_price_paise
            : 0;
        const pct = discountPercent(b.mrp_paise, b.selling_price_paise);
        return (
          <article key={b.id} className="overflow-hidden rounded-[28px] bg-[var(--ca-navy)] text-white ns-elev-3">
            <div className="grid gap-6 p-6 sm:grid-cols-[0.9fr_1.1fr] sm:p-8">
              <NotebookStack coverUrl={b.cover_url} title={b.short_name || b.name} subject={b.subject || "Bundle"} />
              <div>
                <p className="ca-eyebrow">Bundle</p>
                <h3 className="mt-2 font-heading text-2xl font-bold">{b.name}</h3>
                <p className="mt-2 text-sm text-white/70">{b.edition || "Printed as a single dispatch."}</p>
                {detail?.bundle_items?.length ? (
                  <ul className="mt-4 space-y-1.5 text-sm text-white/80">
                    {detail.bundle_items.slice(0, 6).map((item) => (
                      <li key={item.product_id}>
                        {item.subject || item.name}
                        {item.qty > 1 ? ` × ${item.qty}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-5 flex flex-wrap items-baseline gap-3">
                  <span className="text-3xl font-semibold tabular-nums">{formatPaise(b.selling_price_paise)}</span>
                  {save > 0 && <span className="text-sm font-semibold text-[var(--ca-gold-soft)]">Save {formatPaise(save)}</span>}
                  {pct > 0 && save === 0 && <span className="text-sm text-white/50 line-through">{formatPaise(b.mrp_paise)}</span>}
                </div>
                {detail?.booklets ? (
                  <p className="mt-1 text-xs text-white/50">{detail.booklets} physical booklet{detail.booklets === 1 ? "" : "s"}</p>
                ) : null}
                <Link href={`/notes/products/${b.slug}`} className="ca-btn ca-btn-gold mt-6 rounded-full px-6">
                  View bundle
                </Link>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
