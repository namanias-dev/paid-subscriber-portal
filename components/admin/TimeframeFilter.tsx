"use client";

import { TIMEFRAME_LABELS, istTodayYMD, type TimeframeMode, type TimeframeValue } from "@/lib/dates";

/**
 * Shared timeframe picker (Today / Last 7 / Last 30 / This month / Specific month
 * / Custom range / All time). Emits a {@link TimeframeValue} the caller resolves
 * with {@link resolveTimeframe}. Reused by the Lead CRM, its time-series chart,
 * and the SMS preset-segment timeframe so all three behave identically.
 */
export default function TimeframeFilter({
  value,
  onChange,
  modes,
  size = "md",
}: {
  value: TimeframeValue;
  onChange: (v: TimeframeValue) => void;
  /** Restrict/order the offered modes. Defaults to the full set. */
  modes?: TimeframeMode[];
  size?: "sm" | "md";
}) {
  const order: TimeframeMode[] = modes || ["all", "today", "7d", "30d", "this_month", "month", "range"];
  const pillBase = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {order.map((m) => {
        const active = value.mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange({ mode: m, month: m === "month" ? (value.month || istTodayYMD().slice(0, 7)) : undefined, from: m === "range" ? value.from : undefined, to: m === "range" ? value.to : undefined })}
            className={`rounded-full font-medium transition ${pillBase} ${active ? "bg-primary text-white" : "bg-surface2 text-ink2 hover:bg-surface"}`}
          >
            {TIMEFRAME_LABELS[m]}
          </button>
        );
      })}
      {value.mode === "month" && (
        <input
          type="month"
          value={value.month || istTodayYMD().slice(0, 7)}
          onChange={(e) => onChange({ ...value, mode: "month", month: e.target.value })}
          className="input h-9 max-w-[170px] py-1 text-sm"
        />
      )}
      {value.mode === "range" && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={value.from || ""} onChange={(e) => onChange({ ...value, mode: "range", from: e.target.value })} className="input h-9 max-w-[150px] py-1 text-sm" />
          <span className="text-xs text-muted">to</span>
          <input type="date" value={value.to || ""} onChange={(e) => onChange({ ...value, mode: "range", to: e.target.value })} className="input h-9 max-w-[150px] py-1 text-sm" />
        </div>
      )}
    </div>
  );
}
