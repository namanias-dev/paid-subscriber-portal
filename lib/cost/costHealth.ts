/**
 * Lightweight production cost-health signals.
 * Intentionally avoids heavy DB scans or catalogue HEAD storms — safe for
 * frequent cron/ops checks.
 */

import { mediaCdnConfigured } from "@/lib/cost/mediaBandwidth";
import { r2Configured } from "@/lib/r2";
import { PUBLIC_MEDIA_SIGNED_TTL_SECONDS } from "@/lib/cost/mediaSignedTtl";

/** Cron paths registered in vercel.json — keep in sync when schedules change. */
export const REGISTERED_CRONS = [
  { path: "/api/cron/ping", schedule: "0 6 * * *", runsPerDay: 1 },
  { path: "/api/cron/verify-payments", schedule: "0 3 * * *", runsPerDay: 1 },
  { path: "/api/cron/notes-store-verify", schedule: "*/15 * * * *", runsPerDay: 96 },
  { path: "/api/cron/notes-store-prepare", schedule: "*/5 * * * *", runsPerDay: 288 },
  { path: "/api/cron/notes-store-tracking", schedule: "25 */2 * * *", runsPerDay: 12 },
  { path: "/api/cron/analytics-rollup", schedule: "30 19 * * *", runsPerDay: 1 },
  { path: "/api/cron/campaign-analytics", schedule: "*/5 * * * *", runsPerDay: 288 },
  { path: "/api/cron/sms-dispatch", schedule: "*/10 * * * *", runsPerDay: 144 },
  { path: "/api/cron/sms-dlr", schedule: "20 * * * *", runsPerDay: 24 },
  { path: "/api/cron/media-purge", schedule: "0 20 * * *", runsPerDay: 1 },
  { path: "/api/cron/auth-attempts-ttl", schedule: "0 */6 * * *", runsPerDay: 4 },
  { path: "/api/cron/telegram-dispatch", schedule: "*/2 * * * *", runsPerDay: 720 },
  { path: "/api/cron/telegram-reports", schedule: "35 * * * *", runsPerDay: 24 },
  { path: "/api/cron/access-reminders", schedule: "30 5 * * *", runsPerDay: 1 },
] as const;

export function registeredCronRunsPerDay(): number {
  return REGISTERED_CRONS.reduce((sum, c) => sum + c.runsPerDay, 0);
}

export type CostHealthReport = {
  ok: true;
  checkedAt: string;
  mediaProxySafe: boolean;
  mediaSignedRedirectMode: boolean;
  cdnConfigured: boolean;
  r2Configured: boolean;
  signedRedirectTtlSeconds: number;
  cronCount: number;
  cronRunsPerDay: number;
  densestCron: { path: string; schedule: string; runsPerDay: number };
  notes: string[];
  guidance: string[];
};

export function buildCostHealthReport(): CostHealthReport {
  const cdnConfigured = mediaCdnConfigured();
  const r2 = r2Configured();
  // Production remediates FOT via signed-R2 redirects when CDN unset.
  const mediaSignedRedirectMode = r2 && !cdnConfigured;
  const mediaProxySafe = cdnConfigured || mediaSignedRedirectMode;
  const densest = [...REGISTERED_CRONS].sort((a, b) => b.runsPerDay - a.runsPerDay)[0]!;
  const notes: string[] = [];
  const guidance: string[] = [];

  if (mediaProxySafe && mediaSignedRedirectMode) {
    notes.push("Public media uses signed-R2 302 redirects (CDN Worker unset).");
  }
  if (cdnConfigured) {
    notes.push("CLOUDFLARE_R2_PUBLIC_BASE_URL / NEXT_PUBLIC_MEDIA_CDN_BASE is set.");
  }
  if (!r2) {
    notes.push("R2 credentials look unset — media route may 503 or fall back unsafely.");
    guidance.push("Restore R2 env before public media traffic.");
  }
  if (densest.runsPerDay >= 288) {
    notes.push(`${densest.path} runs ~${densest.runsPerDay}/day (${densest.schedule}).`);
  }
  guidance.push("Alert if Fast Origin Transfer effectiveCost exceeds ~$1/day for 2 days.");
  guidance.push("Keep /media responses as 302 with Content-Length 0 for public catalogue videos.");

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    mediaProxySafe,
    mediaSignedRedirectMode,
    cdnConfigured,
    r2Configured: r2,
    signedRedirectTtlSeconds: PUBLIC_MEDIA_SIGNED_TTL_SECONDS,
    cronCount: REGISTERED_CRONS.length,
    cronRunsPerDay: registeredCronRunsPerDay(),
    densestCron: densest,
    notes,
    guidance,
  };
}
