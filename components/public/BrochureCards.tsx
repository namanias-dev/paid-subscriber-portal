import { FileText, Download } from "lucide-react";
import { formatBytes } from "@/lib/dates";
import type { LibraryDoc } from "@/lib/types";

/** Premium download cards for brochures/resources from the central library. */
export default function BrochureCards({ docs }: { docs?: LibraryDoc[] | null }) {
  const items = (docs || []).filter((d) => d?.file_url?.trim());
  if (!items.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((d) => (
        <a
          key={d.id}
          href={d.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="ca-focus group flex items-center gap-3 rounded-2xl border border-[var(--ca-slate-200)] bg-white p-4 shadow-soft-sm transition hover:-translate-y-0.5 hover:border-[rgba(212,175,55,0.6)] motion-reduce:hover:translate-y-0"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[rgba(212,175,55,0.14)] text-[var(--ca-gold)]">
            <FileText size={20} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-[var(--ca-navy-900)]">{d.title}</span>
            <span className="block text-xs text-[var(--ca-slate-400)]">
              {d.category ? `${d.category} · ` : ""}PDF{formatBytes(d.file_size) ? ` · ${formatBytes(d.file_size)}` : ""}
            </span>
          </span>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[var(--ca-navy-600)] transition group-hover:bg-[var(--ca-slate-50)] group-hover:text-[var(--ca-gold)]">
            <Download size={18} aria-hidden="true" />
          </span>
        </a>
      ))}
    </div>
  );
}
