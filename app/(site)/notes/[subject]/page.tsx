import { notFound } from "next/navigation";
import ProductCard from "@/components/notes/ProductCard";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
import { getCategoryBySlug, listActiveProducts } from "@/lib/store/catalogue";
import { getActiveStoreOffer, toPricingOffer } from "@/lib/store/offers";
import Link from "next/link";
import { BookOpen } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  const [products, offerRow] = await Promise.all([
    listActiveProducts({ categoryId: cat.id }),
    getActiveStoreOffer(),
  ]);
  const offer = offerRow ? toPricingOffer(offerRow) : null;
  const title = cat.nav_label || cat.name;

  return (
    <>
      <CaPageHeader
        eyebrow="Printed notes"
        title={title}
        subtitle={cat.short_description || undefined}
        icon={BookOpen}
        crumbs={[
          { label: "Notes", href: "/notes" },
          { label: title },
        ]}
      />
      <div className="container-wide py-10 pb-16">
        {params.subject === "current-affairs" && (
          <p className="mb-8 text-sm text-[var(--ca-navy)]/55">
            Looking for daily articles instead? See the academy&apos;s{" "}
            <Link href="/current-affairs" className="font-semibold text-[var(--ca-navy)] underline">
              Current Affairs
            </Link>{" "}
            desk — this page is the printed compilations.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} offer={offer} />
          ))}
          {products.length === 0 && (
            <div className="col-span-full rounded-3xl border border-dashed border-[var(--ca-navy)]/15 bg-white p-10 text-center">
              <p className="font-heading text-lg font-semibold text-[var(--ca-navy)]">No notes listed in this subject yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ca-navy)]/55">
                When a title is coming soon, you will be able to record interest from this page. Until then, browse other subjects.
              </p>
              <Link href="/notes" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white">
                Browse all notes
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
