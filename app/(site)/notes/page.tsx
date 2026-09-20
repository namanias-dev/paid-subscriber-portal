import Link from "next/link";
import ProductCard from "@/components/notes/ProductCard";
import TrackView from "@/components/notes/TrackView";
import { listActiveCategories, listActiveProducts } from "@/lib/store/catalogue";

export const revalidate = 600;
export const metadata = {
  title: "Naman Sir's Handwritten UPSC Notes — Delivered to Your Doorstep",
  description:
    "Premium printed hard copies of Naman Sir's handwritten UPSC notes. Exam-focused, revision-ready, delivered pan-India from Chandigarh.",
};

const HOW = [
  { n: "1", t: "Choose your notes", d: "Subject-wise singles or the Complete GS set." },
  { n: "2", t: "Order prepaid", d: "Guest checkout. UPI, cards and net banking via ICICI." },
  { n: "3", t: "We print & pack", d: "Print-on-demand from Chandigarh. Packed for a courier, not a bookshelf." },
  { n: "4", t: "Delivered", d: "A date you can hold us to, not a range." },
];

const WHY = [
  { t: "Curation, not page count", d: "Less material, better organised, written for the paper in front of you." },
  { t: "Handwritten by Naman Sir", d: "The same notes taught in class — diagrams, underlines, the asides that make a topic stick." },
  { t: "Revision-ready binding", d: "Hard copies meant to live on a desk for months, not a printout that falls apart in week two." },
];

const FAQS = [
  { q: "Are these the same notes taught in class?", a: "Yes. Printed from the current edition of Naman Sir's handwritten and curated notes. Editions are marked on each product." },
  { q: "Do you deliver all over India?", a: "Yes, prepaid, from Chandigarh. Enter your PIN on a product page for a concrete delivery date." },
  { q: "Is cash on delivery available?", a: "No. Every order is prepaid. It keeps the price down and the dispatch queue honest." },
  { q: "Can I get a PDF instead?", a: "This store sells printed hard copies only. Sample pages on each product show the real inside pages." },
];

export default async function NotesLanding() {
  const [categories, bestsellers, bundles, products] = await Promise.all([
    listActiveCategories(),
    listActiveProducts({ bestsellers: true, limit: 8 }),
    listActiveProducts({ kind: "bundle", limit: 4 }),
    listActiveProducts({ limit: 8 }),
  ]);
  const gs = bundles[0] || null;
  const samplesFrom = products.find((p) => p.cover_url) || products[0];

  return (
    <>
      <TrackView event="notes_store_viewed" />
      <header className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 320, height: 320, top: -130, right: -70, background: "rgba(212,175,55,0.16)" }} />
        <div className="container-wide relative py-16 sm:py-24">
          <p className="ca-eyebrow">Printed notes · from Chandigarh</p>
          <h1 className="ca-hero-title mt-3 max-w-3xl font-heading text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            Naman Sir's Handwritten UPSC Notes — Delivered to Your Doorstep.
          </h1>
          <p className="mt-4 max-w-xl text-[var(--ca-slate-300)]">
            Premium printed hard copies. Exam-focused, revision-ready, delivered pan-India. You get a delivery date, not a range.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="#catalogue" className="inline-flex min-h-12 items-center rounded-full bg-[var(--ca-gold,#d4af37)] px-6 text-sm font-semibold text-[var(--ca-navy)]">
              Shop notes
            </Link>
            <Link href="#bundles" className="inline-flex min-h-12 items-center rounded-full border border-white/25 px-6 text-sm font-semibold text-white">
              Explore bundles
            </Link>
          </div>
        </div>
      </header>

      <div className="relative z-10 -mt-8 rounded-t-[2rem] bg-[var(--ca-surface)] pb-20">
        <section id="catalogue" className="container-wide pt-12">
          <h2 className="font-heading text-2xl font-bold text-[var(--ca-navy)]">Shop by subject</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/notes/${c.slug}`}
                className="ca-focus rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none"
              >
                <p className="font-heading text-base font-semibold text-[var(--ca-navy)]">{c.nav_label || c.name}</p>
                {c.short_description && <p className="mt-1 text-xs text-[var(--ca-navy)]/55">{c.short_description}</p>}
              </Link>
            ))}
            {categories.length === 0 && (
              <p className="col-span-full rounded-2xl border border-dashed border-[var(--ca-navy)]/15 bg-white p-8 text-sm text-[var(--ca-navy)]/50">
                Catalogue opening shortly. Subjects will appear here once products are activated.
              </p>
            )}
          </div>
        </section>

        <section className="container-wide mt-16">
          <h2 className="font-heading text-2xl font-bold text-[var(--ca-navy)]">Best sellers</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(bestsellers.length ? bestsellers : products).length === 0 ? (
              <p className="col-span-full text-sm text-[var(--ca-navy)]/50">No live titles yet.</p>
            ) : (
              (bestsellers.length ? bestsellers : products).map((p) => <ProductCard key={p.id} product={p} />)
            )}
          </div>
        </section>

        <section id="bundles" className="container-wide mt-16">
          <div className="rounded-3xl bg-[var(--ca-navy)] px-6 py-10 text-white sm:px-10">
            <p className="ca-eyebrow text-[var(--ca-gold,#d4af37)]">Complete GS</p>
            <h2 className="mt-2 font-heading text-3xl font-bold">One set. The notes you'd otherwise buy one by one.</h2>
            <p className="mt-3 max-w-xl text-white/70">
              {gs
                ? `${gs.name} — printed, packed and sent as a single dispatch.`
                : "The Complete GS bundle will appear here once it is listed. Until then, shop by subject."}
            </p>
            {gs && (
              <Link href={`/notes/products/${gs.slug}`} className="mt-6 inline-flex min-h-12 items-center rounded-full bg-white px-6 text-sm font-semibold text-[var(--ca-navy)]">
                View the GS bundle
              </Link>
            )}
          </div>
        </section>

        <section className="container-wide mt-16 grid gap-6 md:grid-cols-3">
          {WHY.map((w) => (
            <div key={w.t} className="rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-6">
              <h3 className="font-heading text-lg font-semibold text-[var(--ca-navy)]">{w.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ca-navy)]/65">{w.d}</p>
            </div>
          ))}
        </section>

        <section className="container-wide mt-16">
          <h2 className="font-heading text-2xl font-bold text-[var(--ca-navy)]">See the pages before you buy</h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ca-navy)]/60">
            Every product carries 4–6 non-contiguous sample pages. The watermark is in the pixels — these are the real notes, at a resolution that is comfortable on a phone and useless on a printer.
          </p>
          {samplesFrom && (
            <Link href={`/notes/products/${samplesFrom.slug}`} className="mt-4 inline-flex text-sm font-semibold text-[var(--ca-navy)] underline">
              Open a product to preview samples
            </Link>
          )}
        </section>

        <section className="container-wide mt-16 grid gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-6">
            <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">Faculty</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ca-navy)]/70">
              Written and taught by Naman Sir at Naman IAS Academy, Chandigarh. These are class notes, not a rebranded compilation. What you receive is what is taught.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--ca-navy)]/10 bg-white p-6">
            <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">Packed to travel</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ca-navy)]/70">
              Printed and packed in Chandigarh. Corner-protected, courier-ready. We quote a delivery date with a buffer built in — if we miss it in launch week, that is on us.
            </p>
          </div>
        </section>

        <section className="container-wide mt-16">
          <h2 className="font-heading text-2xl font-bold text-[var(--ca-navy)]">How it arrives</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW.map((h) => (
              <div key={h.n} className="rounded-2xl bg-white p-5">
                <p className="font-heading text-3xl font-bold text-[var(--ca-gold,#d4af37)]">{h.n}</p>
                <p className="mt-2 font-semibold text-[var(--ca-navy)]">{h.t}</p>
                <p className="mt-1 text-sm text-[var(--ca-navy)]/60">{h.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container-wide mt-16">
          <h2 className="font-heading text-2xl font-bold text-[var(--ca-navy)]">Questions</h2>
          <div className="mt-6 divide-y divide-[var(--ca-navy)]/10 rounded-2xl border border-[var(--ca-navy)]/10 bg-white">
            {FAQS.map((f) => (
              <details key={f.q} className="px-5 py-4">
                <summary className="cursor-pointer font-semibold text-[var(--ca-navy)]">{f.q}</summary>
                <p className="mt-2 text-sm text-[var(--ca-navy)]/65">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="container-wide mt-16 text-center">
          <h2 className="font-heading text-3xl font-bold text-[var(--ca-navy)]">Ready when you are.</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-[var(--ca-navy)]/60">Prepaid, printed, packed, a date on the box. Guest checkout — no account required.</p>
          <Link href="#catalogue" className="mt-6 inline-flex min-h-12 items-center rounded-full bg-[var(--ca-navy)] px-6 text-sm font-semibold text-white">
            Shop notes
          </Link>
        </section>
      </div>
    </>
  );
}
