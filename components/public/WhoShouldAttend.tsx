export default function WhoShouldAttend({ title, items }: { title: string; items?: string[] }) {
  const list = (items || []).filter((s) => s?.trim());
  if (!list.length) return null;
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-extrabold">{title}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {list.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5 rounded-xl border border-line bg-surface2 p-3.5 text-sm text-ink">
            <span className="mt-0.5 text-primary" aria-hidden>✓</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
