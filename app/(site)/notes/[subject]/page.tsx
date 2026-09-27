import { notFound, redirect } from "next/navigation";
import NotesPdp from "@/components/notes/NotesPdp";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
import ProductCard from "@/components/notes/ProductCard";
import { getCategoryBySlug, getProductBySlug, listActiveProducts } from "@/lib/store/catalogue";
import { getActiveStoreOffer, getPublicActiveOffer, toPricingOffer } from "@/lib/store/offers";
import { getNotesCurriculum } from "@/lib/store/notesCurriculum";
import { isNotesReservedSlug, notesProductPath, resolveNotesProductSlug } from "@/lib/store/paths";
import { SITE_URL } from "@/lib/config";
import Link from "next/link";
import { BookOpen } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: { subject: string } }) {
  const slug = resolveNotesProductSlug(params.subject);
  const product = await getProductBySlug(slug);
  if (product) {
    const story = getNotesCurriculum(product.slug);
    return {
      title: product.seo_title || story?.seoTitle || `${product.name} for UPSC | Naman Sir`,
      description: product.seo_description || story?.seoDescription || product.short_description || `Printed ${product.name}, delivered from Chandigarh.`,
      alternates: { canonical: `${SITE_URL}${notesProductPath(product.slug)}` },
    };
  }
  const cat = await getCategoryBySlug(params.subject);
  if (!cat) return { title: "Notes" };
  return {
    title: `${cat.nav_label || cat.name} — Naman IAS Notes`,
    description: cat.short_description || `Printed ${cat.name} notes, delivered from Chandigarh.`,
  };
}

export default async function NotesSubjectOrProductPage({ params }: { params: { subject: string } }) {
  if (isNotesReservedSlug(params.subject)) notFound();

  const canonicalSlug = resolveNotesProductSlug(params.subject);
  if (canonicalSlug !== params.subject) {
    redirect(notesProductPath(canonicalSlug));
  }

  const product = await getProductBySlug(canonicalSlug);
  if (product) {
    const [offerRow, publicOffer] = await Promise.all([getActiveStoreOffer(), getPublicActiveOffer()]);
    return <NotesPdp p={product} offer={offerRow ? toPricingOffer(offerRow) : null} publicOffer={publicOffer} />;
  }

  const cat = await getCategoryBySlug(params.subject);
  if (!cat) notFound();
  const [products, offerRow] = await Promise.all([
    listActiveProducts({ categoryId: cat.id }),
    getActiveStoreOffer(),
  ]);
  const singles = products.filter((p) => p.kind === "single");
  if (singles.length === 1) {
    redirect(notesProductPath(singles[0].slug));
  }

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
                Tell us what you want next in Student Voices on the Notes store.
              </p>
              <Link href="/notes#student-voices" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--ca-navy)] px-5 text-sm font-semibold text-white">
                Browse all notes
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
