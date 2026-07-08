import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { resourceCategoryName } from "@/lib/resourceConstants";
import type { Resource } from "@/lib/types";

export default function ResourceCard({ resource }: { resource: Resource }) {
  return (
    <Link
      href={`/resources/${resource.slug}`}
      className="ca-card ca-focus group flex flex-col overflow-hidden"
    >
      {resource.featured_image && (
        <div className="aspect-[16/9] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resource.featured_image} alt={resource.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-center gap-2">
          {resource.category && (
            <span className="inline-flex items-center rounded-full border border-[rgba(30,58,138,0.16)] bg-[rgba(30,58,138,0.08)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--ca-navy-600)]">
              {resourceCategoryName(resource.category)}
            </span>
          )}
          {resource.reading_time ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ca-slate-400)]"><Clock size={12} /> {resource.reading_time} min</span>
          ) : null}
        </div>
        <h3 className="mt-3 font-heading text-lg font-bold leading-snug tracking-tight text-[var(--ca-navy-900)] group-hover:text-[var(--ca-navy-600)]">
          {resource.title}
        </h3>
        {resource.summary && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--ca-slate-700)]">{resource.summary}</p>}
        <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--ca-navy-600)]">
          Read guide <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
