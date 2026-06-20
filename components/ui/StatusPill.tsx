import { daysLeft, isExpired, isExpiringSoon } from "@/lib/dates";

export type Status = "active" | "expiring" | "expired" | "lifetime";

export function statusOf(expiry: string | null, isActive = true): Status {
  if (!isActive) return "expired";
  if (expiry === null) return "lifetime";
  if (isExpired(expiry)) return "expired";
  if (isExpiringSoon(expiry)) return "expiring";
  return "active";
}

export default function StatusPill({
  expiry,
  isActive = true,
}: {
  expiry: string | null;
  isActive?: boolean;
}) {
  const status = statusOf(expiry, isActive);
  const map: Record<Status, { cls: string; label: string }> = {
    active: { cls: "pill-green", label: "Active" },
    expiring: { cls: "pill-amber", label: `Expiring (${daysLeft(expiry)}d)` },
    expired: { cls: "pill-red", label: "Expired" },
    lifetime: { cls: "pill-saffron", label: "Lifetime ∞" },
  };
  const { cls, label } = map[status];
  return <span className={`pill ${cls}`}>{label}</span>;
}
