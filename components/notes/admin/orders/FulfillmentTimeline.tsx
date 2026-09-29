import { stageProgress, TIMELINE } from "@/lib/store/opsBoard";

const EASE = "duration-500 ease-out motion-reduce:transition-none";

export function FulfillmentTimeline({ status, compact = false }: { status: string; compact?: boolean }) {
  const stage = stageProgress(status);
  if (!stage) return null;
  const current = stage.index;
  const dot = compact ? "h-2 w-2" : "h-2.5 w-2.5";
  return (
    <div role="img" aria-label={stage.ariaLabel} className="inline-flex">
      <ol className={`flex items-center ${compact ? "gap-0" : "gap-1"}`} aria-hidden>
        {TIMELINE.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={step.key} className="flex min-w-0 items-center" title={step.label}>
              <span className="flex flex-col items-center gap-1">
                <span className={`relative block ${dot}`}>
                  {active && !stage.final && (
                    <span className="absolute inset-0 hidden rounded-full bg-[var(--ca-gold-dark)] motion-safe:block motion-safe:animate-stage-breathe" />
                  )}
                  <span
                    className={`absolute inset-0 rounded-full border transition-[background-color,border-color,box-shadow] ${EASE} ${
                      done
                        ? "border-[var(--ca-navy)] bg-[var(--ca-navy)]"
                        : active
                          ? "border-[var(--ca-gold-dark)] bg-[var(--ca-gold-dark)] shadow-[0_0_0_3px_rgba(154,123,47,0.18)]"
                          : "border-ca-navy/25 bg-transparent"
                    }`}
                  />
                </span>
                {!compact && (
                  <span className={`max-w-[4.5rem] text-center text-[10px] leading-tight ${active ? "font-semibold text-[var(--ca-navy)]" : "text-ca-navy/45"}`}>
                    {done ? `✓ ${step.label}` : step.label}
                  </span>
                )}
              </span>
              {index < TIMELINE.length - 1 && (
                <span className={`mx-1 block h-px transition-colors ${EASE} ${compact ? "w-3" : "w-4"} ${index < current ? "bg-ca-navy/50" : "bg-ca-navy/15"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
