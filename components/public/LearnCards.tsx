import type { LearnItem } from "@/lib/types";

export default function LearnCards({
  title,
  subtitle,
  items,
  defaultIcon = "✓",
}: {
  title: string;
  subtitle?: string;
  items?: LearnItem[];
  defaultIcon?: string;
}) {
  const list = (items || []).filter((i) => i?.title?.trim());
  if (!list.length) return null;
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-extrabold">{title}</h2>
      {subtitle && <p className="mt-1 text-ink2">{subtitle}</p>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {list.map((it, i) => (
          <div key={i} className="card flex gap-3 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-lg" aria-hidden>
              {it.icon?.trim() || defaultIcon}
            </span>
            <div>
              <p className="font-semibold text-ink">{it.title}</p>
              {it.desc?.trim() && <p className="mt-0.5 text-sm text-ink2">{it.desc}</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
