import type { PdfResource } from "@/lib/types";

export default function ResourceList({ resources }: { resources?: PdfResource[] | null }) {
  const items = (resources || []).filter((r) => r.url?.trim());
  if (!items.length) return null;
  return (
    <ul className="space-y-2">
      {items.map((r, i) => (
        <li key={i}>
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface2 px-4 py-3 text-sm transition hover:border-primary"
          >
            <span className="flex items-center gap-2 font-medium text-ink">
              <span aria-hidden>📄</span> {r.label || "Download PDF"}
            </span>
            <span className="text-primary">Download ↓</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
