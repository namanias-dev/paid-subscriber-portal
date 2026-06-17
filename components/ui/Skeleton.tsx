export default function Skeleton({
  className = "",
  height = 16,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <div
      className={`skeleton animate-shimmer ${className}`}
      style={{ height }}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="card p-4">
      <Skeleton className="mb-3 w-2/3" height={18} />
      <Skeleton className="mb-2 w-full" height={12} />
      <Skeleton className="w-1/2" height={12} />
    </div>
  );
}
