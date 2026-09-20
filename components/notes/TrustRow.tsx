const ITEMS = [
  "Prepared by Naman Sir",
  "Physical hard-copy notes",
  "Sample pages available",
  "PAN-India delivery",
];

export default function TrustRow({ hasSamples = true }: { hasSamples?: boolean }) {
  const items = hasSamples ? ITEMS : ITEMS.filter((i) => i !== "Sample pages available");
  return (
    <ul className="grid grid-cols-2 gap-2 text-xs font-semibold text-[var(--ca-navy)]/70 sm:grid-cols-4">
      {items.map((item) => (
        <li key={item} className="rounded-2xl border border-[var(--ca-navy)]/10 bg-white px-3 py-2">
          {item}
        </li>
      ))}
    </ul>
  );
}
