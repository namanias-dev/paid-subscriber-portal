/**
 * SMS delivery for one send-date cohort.
 *
 * A row is counted on the IST day it was created (`sms_logs.created_at`), not
 * the day a delivery receipt arrived. Provider acceptance (SENT) is not
 * handset delivery. A missing receipt stays pending. FAILED is only the
 * provider's failed status.
 *
 * Each log row is one provider attempt. A retry is a new row and counts again.
 * Rows that share a dedupe key are one attempt (the best status wins), so a
 * duplicate callback is not a second message. Handset delivery is only
 * DELIVERED.
 */
import { inWindow, type TimeWindow } from "./businessMetrics";

export type SmsCohortStatus = "QUEUED" | "SENT" | "FAILED" | "DELIVERED" | "UNKNOWN";

export interface SmsCohortRow {
  id: string;
  status: string;
  templateName?: string | null;
  templateId?: string | null;
  /** Used only to collapse retries. Never printed. */
  mobile?: string | null;
  enrollmentId?: string | null;
  installmentNo?: number | null;
  dedupeKey?: string | null;
  createdAt: string;
}

export interface SmsTemplateLine {
  name: string;
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
  queued: number;
}

export interface SmsDeliveryMetrics {
  /** Logical messages whose provider accepted them or returned a final result. */
  sent: number;
  /** Handset-confirmed. */
  delivered: number;
  /** Provider-confirmed failure. */
  failed: number;
  /** Accepted or unknown, with no final receipt yet. Includes SENT and UNKNOWN. */
  pending: number;
  /** Logged, not yet accepted by the provider. */
  queued: number;
  templates: SmsTemplateLine[];
}

const RANK: Record<SmsCohortStatus, number> = {
  FAILED: 1,
  QUEUED: 2,
  UNKNOWN: 3,
  SENT: 4,
  DELIVERED: 5,
};

export function normalizeSmsStatus(raw: string | null | undefined): SmsCohortStatus {
  const s = String(raw || "").trim().toUpperCase();
  if (s === "DELIVERED" || s === "SENT" || s === "FAILED" || s === "QUEUED" || s === "UNKNOWN") return s;
  return "UNKNOWN";
}

/** Fixture mobiles used by scripts (90000000xx). Not a real academy handset pattern we send to. */
export function isInternalSmsTestMobile(mobile: string | null | undefined): boolean {
  const digits = String(mobile || "").replace(/\D/g, "");
  const core = digits.length > 10 ? digits.slice(-10) : digits;
  return /^90000000\d{2}$/.test(core);
}

export function smsTemplateLabel(name: string | null | undefined): string {
  const raw = String(name || "").trim();
  if (!raw) return "Unnamed template";
  if (raw.includes(" ")) return raw;
  return raw
    .split("_")
    .filter(Boolean)
    .map((word) => {
      if (word === word.toUpperCase() && /^(UPSC|IAS|OTP|SMS|DLT)$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function logicalKey(row: SmsCohortRow): string {
  const dedupe = (row.dedupeKey || "").trim();
  if (dedupe) return `k:${dedupe}`;
  return `id:${row.id}`;
}

function tally(status: SmsCohortStatus): { sent: number; delivered: number; failed: number; pending: number; queued: number } {
  if (status === "DELIVERED") return { sent: 1, delivered: 1, failed: 0, pending: 0, queued: 0 };
  if (status === "FAILED") return { sent: 1, delivered: 0, failed: 1, pending: 0, queued: 0 };
  if (status === "QUEUED") return { sent: 0, delivered: 0, failed: 0, pending: 0, queued: 1 };
  return { sent: 1, delivered: 0, failed: 0, pending: 1, queued: 0 };
}

export function computeSmsDelivery(
  rows: SmsCohortRow[],
  window: TimeWindow,
  opts?: { excludedMobiles?: Set<string> },
): SmsDeliveryMetrics {
  const excluded = opts?.excludedMobiles || new Set<string>();
  const best = new Map<string, { status: SmsCohortStatus; name: string }>();

  for (const row of rows) {
    if (!inWindow(row.createdAt, window)) continue;
    if (isInternalSmsTestMobile(row.mobile)) continue;
    const digits = String(row.mobile || "").replace(/\D/g, "").slice(-10);
    if (digits && excluded.has(digits)) continue;
    const label = smsTemplateLabel(row.templateName);
    if (/^test\b/i.test(label)) continue;
    const status = normalizeSmsStatus(row.status);
    const key = logicalKey(row);
    const prev = best.get(key);
    if (!prev || RANK[status] > RANK[prev.status]) {
      best.set(key, { status, name: prev?.name && prev.name !== "Unnamed template" ? prev.name : label });
    } else if (prev.name === "Unnamed template" && label !== "Unnamed template") {
      prev.name = label;
    }
  }

  const templates = new Map<string, SmsTemplateLine>();
  const total = { sent: 0, delivered: 0, failed: 0, pending: 0, queued: 0 };
  for (const item of best.values()) {
    const part = tally(item.status);
    total.sent += part.sent;
    total.delivered += part.delivered;
    total.failed += part.failed;
    total.pending += part.pending;
    total.queued += part.queued;
    const line = templates.get(item.name) || {
      name: item.name,
      sent: 0,
      delivered: 0,
      failed: 0,
      pending: 0,
      queued: 0,
    };
    line.sent += part.sent;
    line.delivered += part.delivered;
    line.failed += part.failed;
    line.pending += part.pending;
    line.queued += part.queued;
    templates.set(item.name, line);
  }

  const templateLines = [...templates.values()]
    .filter((t) => t.sent + t.queued > 0)
    .sort((a, b) => b.sent + b.queued - (a.sent + a.queued) || a.name.localeCompare(b.name));

  return { ...total, templates: templateLines };
}

export function smsDeliveryReconciles(m: SmsDeliveryMetrics): boolean {
  const sentParts = m.delivered + m.failed + m.pending;
  if (m.sent !== sentParts) return false;
  const tSent = m.templates.reduce((a, t) => a + t.sent, 0);
  const tDel = m.templates.reduce((a, t) => a + t.delivered, 0);
  const tFail = m.templates.reduce((a, t) => a + t.failed, 0);
  const tPend = m.templates.reduce((a, t) => a + t.pending, 0);
  const tQueue = m.templates.reduce((a, t) => a + t.queued, 0);
  return (
    tSent === m.sent &&
    tDel === m.delivered &&
    tFail === m.failed &&
    tPend === m.pending &&
    tQueue === m.queued
  );
}
