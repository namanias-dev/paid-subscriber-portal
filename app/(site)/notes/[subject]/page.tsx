import { notFound } from "next/navigation";
import ProductCard from "@/components/notes/ProductCard";
import { getCategoryBySlug, listActiveProducts } from "@/lib/store/catalogue";
import Link from "next/link";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { subject: string } }) {
  const cat = await getCategoryBySlug(params.subject);
  if (!cat) return { title: "Notes" };
  return {
    title: `${cat.nav_label || cat.name} — Naman IAS Notes`,
    description: cat.short_description || `Printed ${cat.name} notes, delivered from Chandigarh.`,
  };
}

const RESERVED = new Set(["cart", "checkout", "products", "order", "track", "faqs", "bundles"]);

export default async function SubjectPage({ params }: { params: { subject: string } }) {
  if (RESERVED.has(params.subject)) notFound();
  const cat = await getCategoryBySlug(params.subject);
  if (!cat) notFound();
  const products = await listActiveProducts({ categoryId: cat.id });
  return (
    <div className="container-wide py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark,#9a7b2f)]">
        <Link href="/notes">Notes</Link> · {cat.nav_label || cat.name}
      </p>
      <h1 className="mt-3 font-heading text-4xl font-bold text-[var(--ca-navy)]">{cat.nav_label || cat.name}</h1>
      {cat.short_description && <p className="mt-3 max-w-2xl text-[var(--ca-navy)]/65">{cat.short_description}</p>}
      {params.subject === "current-affairs" && (
        <p className="mt-3 text-sm text-[var(--ca-navy)]/55">
          Looking for daily articles instead? See the academy's{" "}
          <Link href="/current-affairs" className="underline">
            Current Affairs
          </Link>{" "}
          desk — this page is the printed compilations.
        </p>
      )}
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
        {products.length === 0 && <p className="text-sm text-[var(--ca-navy)]/50">Nothing listed in this subject yet.</p>}
      </div>
    </div>
  );
}
