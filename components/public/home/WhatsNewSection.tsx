import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { WhatsNew, WhatsNewItem } from "@/lib/announcements";
import Reveal from "@/components/ui/Reveal";
import WhatsNewCarousel from "./WhatsNewCarousel";

/**
 * "What's New / Latest Updates" — premium cards auto-sourced from live data
 * (open webinars, open batches, latest guides, new PDFs, pinned announcements).
 * Renders nothing when there is nothing new.
 *
 * Mobile: the section header is STICKY within the section (top-16, below the
 * global nav, z-20 so it never overlays nav/payment controls) so it stays
 * visible while the rotating ticker/cards scroll. Desktop keeps the classic
 * header + grid. The rotating motion + responsive readability live in the
 * client {@link WhatsNewCarousel}.
 */
export default function WhatsNewSection({ data }: { data: WhatsNew }) {
  // Interleave across groups so the feed shows variety, cap at 8.
  const groups = [data.webinars, data.batches, data.articles, data.downloads];
  const interleaved: WhatsNewItem[] = [];
  for (let i = 0; i < 4; i++) {
    for (const g of groups) if (g[i]) interleaved.push(g[i]);
  }
  const items = [...data.barItems.filter((b) => b.kind === "pinned"), ...interleaved]
    // de-dupe by id (a pinned item + auto item never collide, but be safe)
    .filter((it, i, arr) => arr.findIndex((x) => x.id === it.id) === i)
    .slice(0, 8);

  if (items.length === 0) return null;

  return (
    <section className="section container-wide">
      {/* Sticky on mobile only; static on sm+. z-20 keeps it under the nav (z-50). */}
      <div className="sticky top-16 z-20 -mx-4 border-b border-line bg-[var(--canvas)] px-4 py-3 shadow-sm sm:static sm:z-auto sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <p className="pill pill-blue mb-2 inline-flex items-center gap-1.5 sm:mb-3">
                <Sparkles size={13} /> What&apos;s New
              </p>
              <h2 className="text-2xl font-extrabold leading-tight sm:text-4xl">Latest updates</h2>
              <p className="mt-1 hidden text-ink2 sm:mt-2 sm:block">
                Fresh guides, PDFs, open batches and upcoming live sessions — all in one place.
              </p>
            </div>
            <Link href="/resources" className="btn btn-secondary shrink-0">Explore resources →</Link>
          </div>
        </Reveal>
      </div>

      <WhatsNewCarousel items={items} />
    </section>
  );
}
