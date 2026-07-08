import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { groupByStage } from "@/lib/resourceView";
import type { Resource } from "@/lib/types";

/**
 * The chronological "Day 1 → Exam" roadmap. Sequences beginner guides by stage
 * and order, so a new aspirant can read start to finish.
 */
export default function JourneyRoadmap({ resources, activeSlug }: { resources: Resource[]; activeSlug?: string }) {
  const stages = groupByStage(resources);
  if (stages.length === 0) return null;

  return (
    <div className="relative">
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-[var(--ca-gold)] via-[var(--ca-slate-200)] to-transparent" aria-hidden />
      <ol className="space-y-8">
        {stages.map((group, gi) => (
          <li key={group.stage}>
            <div className="flex items-center gap-3">
              <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ca-navy-900)] font-heading text-sm font-bold text-white shadow-[0_6px_16px_-6px_rgba(10,26,63,0.6)]">
                {gi + 1}
              </span>
              <h3 className="font-heading text-lg font-bold tracking-tight text-[var(--ca-navy-900)]">{group.stage.replace(/^Stage \d+: /, "")}</h3>
            </div>
            <ul className="ml-11 mt-3 space-y-2">
              {group.items.map((r) => {
                const active = r.slug === activeSlug;
                return (
                  <li key={r.id}>
                    <Link
                      href={`/resources/${r.slug}`}
                      className={`ca-focus group flex items-center gap-3 rounded-xl border p-3 transition ${active ? "border-[rgba(212,175,55,0.6)] bg-[var(--ca-gold-soft)]" : "border-[var(--ca-slate-200)] bg-white hover:border-[rgba(30,58,138,0.25)]"}`}
                    >
                      <CheckCircle2 size={17} className={active ? "text-[var(--ca-gold)]" : "text-[var(--ca-slate-300)]"} />
                      <span className={`flex-1 text-sm font-medium leading-snug ${active ? "text-[var(--ca-navy-900)]" : "text-[var(--ca-slate-800)]"}`}>{r.title}</span>
                      <ArrowRight size={15} className="text-[var(--ca-slate-300)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ca-navy-600)]" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
