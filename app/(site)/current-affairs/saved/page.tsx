import type { Metadata } from "next";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import CaPageHeader from "@/components/public/ca/CaPageHeader";
import { getCaBookmarkSlugs, getPublicCaArticles } from "@/lib/dataProvider";
import { getCurrentUserPhone } from "@/lib/caSession";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Saved Current Affairs", robots: { index: false, follow: false } };

export default async function SavedPage() {
  const phone = await getCurrentUserPhone();

  if (!phone) {
    return (
      <div>
        <CaPageHeader eyebrow="Bookmarks" title="Saved Current Affairs" icon={Bookmark} crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: "Saved" }]} />
        <div className="container-wide py-16 text-center">
          <p className="text-[var(--ca-slate-700)]">Log in to view your saved articles.</p>
          <Link href="/portal/login?next=/current-affairs/saved" className="ca-btn ca-btn-gold ca-focus mt-5 inline-flex">Log in</Link>
        </div>
      </div>
    );
  }

  const [slugs, all] = await Promise.all([getCaBookmarkSlugs(phone), getPublicCaArticles()]);
  const saved = all.filter((a) => slugs.includes(a.slug));

  return (
    <div>
      <CaPageHeader eyebrow="Bookmarks" title="Your saved articles" icon={Bookmark} crumbs={[{ label: "Current Affairs", href: "/current-affairs" }, { label: "Saved" }]} />
      <div className="container-wide py-12">
        {saved.length === 0 ? (
          <p className="rounded-2xl border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-10 text-center text-[var(--ca-slate-700)]">
            You haven&apos;t saved any articles yet. Tap <b>Save</b> on any article to bookmark it.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map((a) => <CaArticleCard key={a.id} article={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
