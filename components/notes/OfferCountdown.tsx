"use client";

import { useEffect, useMemo, useState } from "react";
import { splitOfferRemaining } from "@/lib/store/offerTime";

export { splitOfferRemaining } from "@/lib/store/offerTime";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function OfferCountdown({
  endsAt,
  serverNow,
  compact = false,
  onEnded,
}: {
  endsAt: string;
  serverNow?: string;
  compact?: boolean;
  onEnded?: () => void;
}) {
  const end = useMemo(() => new Date(endsAt).getTime(), [endsAt]);
  const [now, setNow] = useState(() => (serverNow ? new Date(serverNow).getTime() : Date.now()));
  const parts = splitOfferRemaining(end - now);

  useEffect(() => {
    const remaining = end - Date.now();
    const intervalMs = remaining > 86_400_000 ? 30_000 : 1_000;
    const tick = window.setInterval(() => setNow(Date.now()), intervalMs);
    const untilEnd = Math.max(250, remaining + 400);
    const expire = window.setTimeout(() => onEnded?.(), Math.min(untilEnd, 2_147_000_000));
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(expire);
    };
  }, [end, onEnded]);

  const units = parts.showSeconds
    ? [
        { n: pad(parts.hours), l: "Hrs" },
        { n: pad(parts.minutes), l: "Min" },
        { n: pad(parts.seconds), l: "Sec" },
      ]
    : [
        { n: pad(parts.days), l: "Days" },
        { n: pad(parts.hours), l: "Hrs" },
        { n: pad(parts.minutes), l: "Min" },
      ];

  return (
    <div className={compact ? "ns-offer-timer ns-offer-timer--compact" : "ns-offer-timer"} aria-hidden="true">
      {units.map((u) => (
        <div key={u.l} className="ns-offer-timer-cell">
          <span className="ns-offer-timer-num tabular-nums">{parts.ended ? "00" : u.n}</span>
          <span className="ns-offer-timer-lab">{u.l}</span>
        </div>
      ))}
    </div>
  );
}
