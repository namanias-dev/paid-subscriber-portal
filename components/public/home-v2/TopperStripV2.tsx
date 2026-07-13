import Link from "next/link";
import Image from "next/image";
import { Medal, ArrowRight } from "lucide-react";
import type { Topper } from "@/lib/types";

function initials(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "★";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

/**
 * V2-local topper showcase. A premium light-on-gold card grid built from the
 * admin-owned `toppers` list (never invented). Kept separate from the shared
 * TopperCard so the /results page and other consumers are untouched; here the
 * 🏅 emoji is replaced with a real Medal icon.
 */
export default function TopperStripV2({
  toppers,
  heading,
  subtitle,
}: {
  toppers: Topper[];
  heading?: string;
  subtitle?: string;
}) {
  if (!toppers?.length) return null;
  const list = [...toppers].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).slice(0, 8);

  return (
    <section className="section bg-surface">
      <div className="container-wide">
        <div className="max-w-2xl" data-hv2-reveal>
          <p className="pill pill-gold mb-3">Our results speak</p>
          <h2 className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">
            {heading || "Results that speak"}
          </h2>
          <p className="mt-2 text-[var(--ca-slate-700)]">{subtitle || "Real students. Real ranks — across UPSC CSE & IFoS."}</p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4" data-hv2-stagger>
          {list.map((t) => {
            const label = t.name?.trim() || t.rank;
            return (
              <div key={t.id} className="ca-card flex h-full flex-col items-center p-6 text-center">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full ring-4 ring-[rgba(212,175,55,0.25)]">
                  {t.image_url ? (
                    <Image src={t.image_url} alt={label} fill sizes="80px" className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[var(--ca-navy-900)] to-[var(--ca-navy-600)] font-heading text-2xl font-extrabold text-[var(--ca-gold-bright)]">
                      {initials(label)}
                    </div>
                  )}
                </div>
                <div className="mt-4 inline-flex items-center gap-1.5 font-heading text-xl font-extrabold text-[var(--ca-navy-900)]">
                  <Medal size={18} className="text-[var(--ca-gold)]" aria-hidden="true" /> {t.rank}
                </div>
                {t.name?.trim() && <div className="mt-1 font-semibold text-[var(--ca-slate-800)]">{t.name}</div>}
                {t.exam?.trim() && <div className="mt-0.5 text-sm text-[var(--ca-slate-400)]">{t.exam}</div>}
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-center">
          <Link href="/results" className="ca-btn ca-btn-outline ca-focus">
            View all results <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
