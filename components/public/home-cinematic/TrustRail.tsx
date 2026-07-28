import { ShieldCheck } from "lucide-react";
import type { TrustItem } from "@/lib/homeCinematic/trust";

/**
 * Trust rail — SERVER component, no numbers of its own.
 *
 * Every item here has already passed the provenance gate in
 * `lib/homeCinematic/trust.ts`. Anything sourced from a code default, or
 * contradicted by our own tables, never reaches this component. If the gate
 * rejects everything, the whole rail renders nothing rather than showing an
 * awkward partial row.
 *
 * LAYOUT: wraps rather than scrolls and never truncates a figure, so a long value
 * on a 320px screen pushes to a new line instead of being clipped.
 */
export default function TrustRail({ items }: { items: TrustItem[] }) {
  if (!items.length) return null;

  return (
    <div className="border-b border-line bg-white">
      <div className="container-wide flex flex-wrap items-center justify-center gap-x-7 gap-y-3 py-5">
        {items.map((item) => (
          <span
            key={item.label}
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--ca-slate-700)] sm:text-sm"
          >
            <ShieldCheck size={15} className="shrink-0 text-[var(--ca-gold)]" aria-hidden="true" />
            {item.display}
          </span>
        ))}
      </div>
    </div>
  );
}
