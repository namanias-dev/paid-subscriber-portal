import type { SeatConfig } from "@/lib/types";

/**
 * Admin-controlled seats display. Renders nothing unless `seat.show` is true,
 * so the public page never shows a hardcoded/placeholder seats line.
 */
export default function SeatCounter({
  seat,
  compact = false,
}: {
  seat?: SeatConfig | null;
  compact?: boolean;
}) {
  if (!seat?.show) return null;

  const total = seat.total ?? null;
  const remaining = seat.remaining ?? null;
  const fillingFast = seat.show_filling_fast;
  const fillingText = seat.filling_fast_text?.trim() || "Seats Filling Fast";

  let text = seat.text_override?.trim() || "";
  if (!text) {
    if (remaining != null && total != null) text = `Only ${remaining} of ${total} seats remaining`;
    else if (remaining != null) text = `Only ${remaining} seats remaining`;
    else if (total != null) text = `${total} seats in this batch`;
  }
  if (!text && !fillingFast) return null;

  const pct = total && remaining != null ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) : null;

  return (
    <div className={compact ? "" : "rounded-xl border border-line bg-surface2 p-3"}>
      <div className="flex flex-wrap items-center gap-2">
        {fillingFast && <span className="pill pill-saffron">🔥 {fillingText}</span>}
        {text && <span className="text-sm font-semibold text-india">{text}</span>}
      </div>
      {pct != null && !compact && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-saffron" style={{ width: `${100 - pct}%`, background: "var(--saffron)" }} />
        </div>
      )}
    </div>
  );
}
