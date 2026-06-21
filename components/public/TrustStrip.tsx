export interface TrustItem {
  icon: string;
  label: string;
}

/** Compact proof strip shown near the hero. Renders only with real items. */
export default function TrustStrip({ items }: { items?: TrustItem[] }) {
  const list = (items || []).filter((i) => i?.label?.trim());
  if (!list.length) return null;
  return (
    <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {list.map((it, i) => (
        <div key={i} className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2.5">
          <span className="text-lg" aria-hidden>{it.icon}</span>
          <span className="text-xs font-semibold leading-tight text-ink2">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
