import { daysToPrelims } from "@/lib/dates";

export default function CountdownBadge({ targetYear }: { targetYear: number | null }) {
  const days = daysToPrelims(targetYear);
  if (!targetYear || days == null || days < 0) return null;
  return (
    <span className="pill pill-lifetime">
      🗓️ {days} days to Prelims {targetYear}
    </span>
  );
}
