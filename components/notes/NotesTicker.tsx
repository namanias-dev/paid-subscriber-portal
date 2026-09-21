import { DEFAULT_TOPPERS } from "@/lib/homeDefaults";

const BENEFITS = [
  "Physical Hard Copy",
  "Actual Sample Preview",
  "PAN-India Delivery",
  "Structured for UPSC",
  "Prelims + Mains",
  "Prepared by Naman Sir",
];

function namedResults() {
  return DEFAULT_TOPPERS.filter((t) => t.name?.trim() && t.rank?.trim()).map((t) =>
    [t.name.trim(), t.rank.trim(), t.exam].filter(Boolean).join(" · "),
  );
}

function Track({ items, label }: { items: string[]; label: string }) {
  if (!items.length) return null;
  const loop = [...items, ...items];
  return (
    <div className="overflow-x-clip overflow-y-hidden border-y border-white/10" aria-label={label}>
      <div className="flex w-max animate-marquee gap-10 py-3 pr-10 motion-reduce:animate-none">
        {loop.map((item, i) => (
          <span key={`${item}-${i}`} className="text-[12px] font-semibold uppercase tracking-[0.16em] text-white/70">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ResultsTicker() {
  const items = namedResults();
  if (!items.length) return null;
  return (
    <div className="ca-dark">
      <Track items={items} label="Academy results" />
    </div>
  );
}

export function BenefitTicker() {
  return (
    <div className="bg-[var(--ca-navy-900)]">
      <Track items={BENEFITS} label="Notes benefits" />
    </div>
  );
}
