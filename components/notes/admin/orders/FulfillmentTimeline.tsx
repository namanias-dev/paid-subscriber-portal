import { showsFulfillmentTimeline, timelineIndex, TIMELINE } from "@/lib/store/opsBoard";

export function FulfillmentTimeline({ status, compact = false }: { status: string; compact?: boolean }) {
  if (!showsFulfillmentTimeline(status)) return null;
  const current = timelineIndex(status) ?? 0;
  return (
    <ol className={`flex items-center ${compact ? "gap-0" : "gap-1"}`} aria-label="Fulfillment progress">
      {TIMELINE.map((stage, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={stage.key} className="flex min-w-0 items-center">
            <span className="flex flex-col items-center gap-1">
              <span
                className={`block rounded-full ${compact ? "h-2 w-2" : "h-2.5 w-2.5"} ${
                  done
                    ? "bg-[var(--ca-navy)]"
                    : active
                      ? "bg-[var(--ca-gold-dark)] shadow-[0_0_0_3px_rgba(154,106,32,0.18)] motion-safe:animate-pulse motion-reduce:animate-none"
                      : "border border-[var(--ca-navy)]/25 bg-transparent"
                }`}
                aria-hidden
              />
              {!compact && (
                <span className={`max-w-[4.5rem] text-center text-[10px] leading-tight ${active ? "font-semibold text-[var(--ca-navy)]" : "text-[var(--ca-navy)]/45"}`}>
                  {done ? `✓ ${stage.label}` : stage.label}
                </span>
              )}
            </span>
            {index < TIMELINE.length - 1 && (
              <span className={`mx-1 h-px ${compact ? "w-3" : "w-4"} ${index < current ? "bg-[var(--ca-navy)]/50" : "bg-[var(--ca-navy)]/15"}`} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
