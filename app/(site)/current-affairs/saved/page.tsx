import type { Metadata } from "next";
import Link from "next/link";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import { getCaBookmarkSlugs, getPublicCaArticles } from "@/lib/dataProvider";
import { getCurrentUserPhone } from "@/lib/caSession";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Saved Current Affairs", robots: { index: false, follow: false } };

export default async function SavedPage() {
  const phone = await getCurrentUserPhone();

  if (!phone) {
    return (
      <div className="container-wide py-16 text-center">
        <h1 className="font-heading text-2xl font-bold">Saved Current Affairs</h1>
        <p className="mt-2 text-ink2">Log in to view your saved articles.</p>
        <Link href="/portal/login?next=/current-affairs/saved" className="btn btn-primary mt-5">Log in</Link>
      </div>
    );
  }

  const [slugs, all] = await Promise.all([getCaBookmarkSlugs(phone), getPublicCaArticles()]);
  const saved = all.filter((a) => slugs.includes(a.slug));

  return (
    <div className="container-wide py-10">
      <nav className="mb-4 text-xs text-muted"><Link href="/current-affairs" className="hover:text-ink">Current Affairs</Link> / Saved</nav>
      <h1 className="font-heading text-3xl font-extrabold sm:text-4xl">Your saved articles</h1>

      {saved.length === 0 ? (
        <p className="mt-10 rounded-xl border border-line bg-surface p-8 text-center text-ink2">
          You haven&apos;t saved any articles yet. Tap <b>☆ Save</b> on any article to bookmark it.
        </p>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {saved.map((a) => <CaArticleCard key={a.id} article={a} />)}
        </div>
      )}
    </div>
  );
}
