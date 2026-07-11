import { getSupabase } from "./supabase";
import { hasDb, hasAuth } from "./env";
import { flagSnapshot } from "./flags";

export type HealthCheck = {
  key: string;
  label: string;
  status: "ok" | "warn" | "down" | "unknown";
  detail: string;
};

export type HealthReport = {
  checks: HealthCheck[];
  flags: Record<string, boolean | number>;
  generatedAt: string;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T | null }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t0, value };
  } catch {
    return { ms: Date.now() - t0, value: null };
  }
}

export async function getHealth(): Promise<HealthReport> {
  const checks: HealthCheck[] = [];
  const sb = getSupabase();

  checks.push({
    key: "auth",
    label: "AIVA auth configured",
    status: hasAuth() ? "ok" : "down",
    detail: hasAuth() ? "Session secret present." : "Missing AIVA_JWT_SECRET/ADMIN_JWT_SECRET.",
  });

  if (!hasDb() || !sb) {
    checks.push({ key: "db", label: "Database connectivity", status: "down", detail: "No Supabase env — running in empty mode." });
  } else {
    const ping = await timed(async () => {
      const { error } = await sb.from("students").select("id", { head: true, count: "exact" }).limit(1);
      if (error) throw error;
      return true;
    });
    checks.push({
      key: "db",
      label: "Database connectivity",
      status: ping.value ? (ping.ms > 1500 ? "warn" : "ok") : "down",
      detail: ping.value ? `Round-trip ${ping.ms}ms.` : "Query failed.",
    });

    // Analytics rollup freshness (portal cron).
    const roll = await timed(async () => {
      const { data } = await sb.from("analytics_daily").select("day, updated_at").order("day", { ascending: false }).limit(1);
      return data?.[0] || null;
    });
    if (roll.value) {
      const day = String((roll.value as any).day);
      const stale = Date.now() - new Date(day).getTime() > 2 * 86400000;
      checks.push({ key: "analytics_rollup", label: "Analytics rollup", status: stale ? "warn" : "ok", detail: `Last rollup day ${day}.` });
    } else {
      checks.push({ key: "analytics_rollup", label: "Analytics rollup", status: "unknown", detail: "No analytics_daily rows found." });
    }

    // SMS gateway posture (read-only view of settings).
    const sms = await timed(async () => {
      const { data } = await sb.from("sms_settings").select("*").limit(1);
      return data?.[0] || null;
    });
    const smsEnabled = process.env.SMS_ENABLED === "true";
    checks.push({
      key: "sms",
      label: "SMS gateway posture",
      status: smsEnabled ? "ok" : "warn",
      detail: smsEnabled ? "SMS_ENABLED=true (portal controls sending)." : "SMS disabled (SMS_ENABLED not true).",
    });

    // Codebase intelligence freshness.
    const snap = await timed(async () => {
      const { data } = await sb.from("aiva_codebase_snapshots").select("commit_sha, indexed_at, status").order("indexed_at", { ascending: false }).limit(1);
      return data?.[0] || null;
    });
    checks.push({
      key: "codebase",
      label: "Codebase intelligence",
      status: snap.value ? "ok" : "warn",
      detail: snap.value ? `Last index ${(snap.value as any).indexed_at} (${(snap.value as any).status}).` : "No snapshot yet — run scripts/aiva-sync-codebase-intelligence.ts.",
    });

    // business_events table presence.
    const be = await timed(async () => {
      const { error } = await sb.from("business_events").select("id", { head: true, count: "exact" }).limit(1);
      if (error) throw error;
      return true;
    });
    checks.push({
      key: "business_events",
      label: "Business event layer",
      status: be.value ? "ok" : "warn",
      detail: be.value ? "business_events table present." : "business_events missing — apply the AIVA foundation migration.",
    });
  }

  return { checks, flags: flagSnapshot(), generatedAt: new Date().toISOString() };
}
