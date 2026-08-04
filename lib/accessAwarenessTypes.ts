/**
 * Client-safe access-awareness types + date helper.
 * Keep entitlements / session out of this module — banners import only from here.
 */
import { formatISTDate } from "./dates";

export type AccessAwarenessVariant = "grace" | "blocked";

export interface AccessAwarenessBanner {
  variant: AccessAwarenessVariant;
  courseId: string;
  courseTitle: string;
  enrollmentId: string;
  amountDue: number;
  installmentNo: number | null;
  installmentLabel: string | null;
  payHref: string;
  graceEndsAt: string | null;
  graceDaysLeft: number | null;
  extensionExpiresAt: string | null;
  extensionDaysLeft: number | null;
  liveAccessAllowed: boolean;
  scheduleStatus: string;
}

export function formatAwarenessDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return formatISTDate(iso);
  } catch {
    return iso.slice(0, 10);
  }
}
