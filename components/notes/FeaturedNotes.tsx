import ProductCard from "./ProductCard";
import type { StoreProductCard } from "@/lib/store/catalogue";

export default function FeaturedNotes({ products }: { products: StoreProductCard[] }) {
  if (!products.length) {
    return (
      <div className="rounded-3xl border border-dashed border-[var(--ca-navy)]/15 bg-white px-6 py-12 text-center">
        <p className="font-heading text-lg font-semibold text-[var(--ca-navy)]">Featured notes coming soon</p>
        <p className="mt-2 text-sm text-[var(--ca-navy)]/55">Live titles will appear here once they are featured in admin.</p>
      </div>
    );
  }
  const [hero, ...rest] = products;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProductCard product={hero} featured />
      <div className="grid gap-4 sm:grid-cols-2">
        {rest.slice(0, 4).map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </div>
  );
}
