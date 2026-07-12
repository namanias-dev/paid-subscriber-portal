import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Video, GraduationCap, BookOpen, FileDown, Megaphone, ArrowRight, Sparkles } from "lucide-react";
import type { WhatsNew, WhatsNewItem, WhatsNewKind } from "@/lib/announcements";
import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";

const KIND_ICON: Record<WhatsNewKind, LucideIcon> = {
  webinar: Video,
  batch: GraduationCap,
  article: BookOpen,
  download: FileDown,
  pinned: Megaphone,
};

function Card({ item }: { item: WhatsNewItem }) {
  const Icon = KIND_ICON[item.kind] || Sparkles;
  const body = (
    <div className="card card-hover flex h-full items-start gap-3 p-5">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-tint)] text-[var(--primary)]">
        <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="pill pill-blue mb-1.5 inline-block text-[11px]">{item.label}</span>
        <h3 className="line-clamp-2 text-base leading-snug">{item.title}</h3>
      </div>
      <ArrowRight size={16} className="mt-1 shrink-0 text-ink2" aria-hidden="true" />
    </div>
  );
  return item.external ? (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className="block h-full">{body}</a>
  ) : (
    <Link href={item.href} className="block h-full">{body}</Link>
  );
}

/**
 * "What's New / Latest Updates" — premium cards auto-sourced from live data
 * (open webinars, open batches, latest guides, new PDFs, pinned announcements).
 * Renders nothing when there is nothing new.
 */
export default function WhatsNewSection({ data }: { data: WhatsNew }) {
  // Interleave across groups so the grid shows variety, cap at 8.
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
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="pill pill-blue mb-3 inline-flex items-center gap-1.5"><Sparkles size={13} /> What&apos;s New</p>
            <h2 className="text-3xl font-extrabold sm:text-4xl">Latest updates</h2>
            <p className="mt-2 text-ink2">Fresh guides, PDFs, open batches and upcoming live sessions — all in one place.</p>
          </div>
          <Link href="/resources" className="btn btn-secondary">Explore resources →</Link>
        </div>
      </Reveal>
      <Stagger className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <StaggerItem key={it.id} className="h-full">
            <Card item={it} />
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
