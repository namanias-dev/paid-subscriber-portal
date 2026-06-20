export default function EmptyState({
  icon = "📭",
  title,
  subtitle,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface2 px-6 py-12 text-center">
      <div className="mb-3 text-4xl">{icon}</div>
      <p className="font-heading text-lg text-ink">{title}</p>
      {subtitle && <p className="mt-1 max-w-xs text-sm text-ink2">{subtitle}</p>}
    </div>
  );
}
