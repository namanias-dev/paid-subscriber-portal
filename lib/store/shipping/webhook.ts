import { timingSafeEqual } from "node:crypto";
import { normalizeCourierStatus, type ShipmentStatus } from "./status";

export interface ParsedCourierEvent {
  provider: "shiprocket" | "delhivery";
  awb: string;
  rawStatus: string;
  mappedStatus: ShipmentStatus | null;
  occurredAt: string | null;
  location: string | null;
  remark: string | null;
  dedupeKey: string;
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
}

/** Constant-time check. Missing configuration or a length mismatch rejects. */
export function webhookAuthorized(presented: string | null, expected: string | null): boolean {
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function shiprocketEvent(body: Record<string, unknown>): ParsedCourierEvent | null {
  const awb = str(body.awb);
  const rawStatus = str(body.shipment_status) || str(body.current_status) || str(body["sr-status-label"]);
  if (!awb || !rawStatus) return null;
  const occurredAt = str(body.current_timestamp) || str(body.etd) || null;
  const remark = str(body.activity) || null;
  return {
    provider: "shiprocket",
    awb,
    rawStatus,
    mappedStatus: normalizeCourierStatus(rawStatus),
    occurredAt,
    location: str(body.location) || null,
    remark,
    dedupeKey: `shiprocket:${awb}:${rawStatus}:${occurredAt || ""}:${remark || ""}`,
  };
}

function delhiveryEvent(body: Record<string, unknown>): ParsedCourierEvent | null {
  const shipment = record(body.Shipment) || record(body.shipment);
  if (!shipment) return null;
  const status = record(shipment.Status) || record(shipment.status);
  const awb = str(shipment.AWB) || str(shipment.awb) || str(shipment.Waybill);
  const rawStatus = str(status?.Status) || str(status?.status) || str(shipment.Status);
  if (!awb || !rawStatus) return null;
  const occurredAt = str(status?.StatusDateTime) || str(status?.statusDateTime) || null;
  const remark = str(status?.Instructions) || str(status?.instructions) || null;
  return {
    provider: "delhivery",
    awb,
    rawStatus,
    mappedStatus: normalizeCourierStatus(rawStatus),
    occurredAt,
    location: str(status?.StatusLocation) || str(status?.statusLocation) || null,
    remark,
    dedupeKey: `delhivery:${awb}:${rawStatus}:${occurredAt || ""}:${remark || ""}`,
  };
}

/**
 * Accept the two payload shapes we have documented:
 * Shiprocket tracking webhook (awb + current_status) and Delhivery package push (Shipment.AWB).
 * Unknown shapes return null so the route can reject them.
 */
export function parseCourierWebhook(body: unknown): ParsedCourierEvent | null {
  const rec = record(body);
  if (!rec) return null;
  if (rec.Shipment || rec.shipment) return delhiveryEvent(rec);
  if (rec.awb || rec.current_status || rec.shipment_status) return shiprocketEvent(rec);
  return null;
}
