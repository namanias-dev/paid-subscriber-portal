/**
 * Cheapest-eligible courier selection with a provider-agnostic address check.
 * This module does not call a courier. The runner injects create/read/cancel.
 */
import { providerDestinationMismatch } from "../address";
import type { CourierQuote } from "./quotes";

export const MAX_AUTO_CANDIDATES = 3;

export interface FulfillCandidate {
  key: string;
  provider: "shiprocket" | "delhivery";
  courier: string;
  service: string;
  courierId: string | null;
  ratePaise: number;
  etaDays: number | null;
}

export interface CreatedCandidate {
  provider: "shiprocket" | "delhivery";
  providerOrderId: string | null;
  providerShipmentId: string | null;
  awb: string | null;
  courierName: string | null;
  labelUrl: string | null;
  pin: string | null;
  city: string | null;
  state: string | null;
  phoneStored: boolean | null;
  possessed: boolean;
  unverified: boolean;
}

export interface FulfillAttempt {
  candidate: FulfillCandidate;
  result: "accepted" | "address_mismatch" | "cancelled" | "stopped" | "ambiguous";
  reason: string;
}

export interface FulfillResult {
  accepted: (FulfillCandidate & {
    awb: string;
    labelUrl: string | null;
    providerShipmentId: string | null;
    providerOrderId: string | null;
  }) | null;
  attempts: FulfillAttempt[];
  blocked: string | null;
  creates: number;
}

export interface PackageLine {
  qty: number;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
}

export function rankEligibleQuotes(quotes: CourierQuote[], excluded: string[] = []): FulfillCandidate[] {
  const blocked = new Set(excluded.map((name) => name.toLowerCase()));
  const eligible = quotes.filter((quote) => {
    if (!quote.prepaid || !Number.isFinite(quote.ratePaise) || quote.ratePaise <= 0) return false;
    const name = `${quote.courier} ${quote.service} ${quote.provider}`.toLowerCase();
    return ![...blocked].some((word) => word && name.includes(word));
  });
  eligible.sort((a, b) => {
    if (a.ratePaise !== b.ratePaise) return a.ratePaise - b.ratePaise;
    const ae = a.etaDays ?? 999;
    const be = b.etaDays ?? 999;
    if (ae !== be) return ae - be;
    return `${a.provider}:${a.courier}`.localeCompare(`${b.provider}:${b.courier}`);
  });
  return eligible.map((quote) => ({
    key: `${quote.provider}|${quote.courier}|${quote.service}|${quote.ratePaise}|${quote.courierId || ""}`,
    provider: quote.provider,
    courier: quote.courier,
    service: quote.service,
    courierId: quote.courierId || null,
    ratePaise: quote.ratePaise,
    etaDays: quote.etaDays,
  }));
}

/** One configured product can ship itself. Mixed or unknown parcels wait for a person. */
export function resolveAutoPackage(lines: PackageLine[]): { ok: true; weightGrams: number; lengthCm: number; widthCm: number; heightCm: number } | { ok: false; reason: "PACKAGE_CONFIRMATION_REQUIRED" } {
  if (lines.length !== 1 || lines[0].qty !== 1) return { ok: false, reason: "PACKAGE_CONFIRMATION_REQUIRED" };
  const line = lines[0];
  if (!line.weightGrams || !line.lengthMm || !line.widthMm || !line.heightMm) {
    return { ok: false, reason: "PACKAGE_CONFIRMATION_REQUIRED" };
  }
  return {
    ok: true,
    weightGrams: line.weightGrams,
    lengthCm: line.lengthMm / 10,
    widthCm: line.widthMm / 10,
    heightCm: line.heightMm / 10,
  };
}

export function destinationRejected(
  canonical: { city: string; state: string; pincode: string },
  stored: { pin: string | null; city: string | null; state: string | null },
): boolean {
  const pin = String(stored.pin || "").trim();
  if (pin && pin !== canonical.pincode.trim()) return true;
  if (!pin || !stored.city || !stored.state) return false;
  return providerDestinationMismatch(canonical, { pincode: pin, city: stored.city, state: stored.state });
}

export async function fulfillCheapest(input: {
  quotes: CourierQuote[];
  excluded?: string[];
  maxAttempts?: number;
  canonical: { city: string; state: string; pincode: string };
  create: (candidate: FulfillCandidate) => Promise<CreatedCandidate>;
  reconcile: (candidate: FulfillCandidate) => Promise<CreatedCandidate | null>;
  cancel: (created: CreatedCandidate) => Promise<boolean>;
}): Promise<FulfillResult> {
  const ranked = rankEligibleQuotes(input.quotes, input.excluded || []);
  const max = Math.min(input.maxAttempts ?? MAX_AUTO_CANDIDATES, MAX_AUTO_CANDIDATES);
  const attempts: FulfillAttempt[] = [];
  let creates = 0;
  if (!ranked.length) {
    return { accepted: null, attempts, blocked: "NO_COURIER_AVAILABLE", creates };
  }
  for (const candidate of ranked) {
    if (attempts.filter((row) => row.result !== "ambiguous").length >= max && attempts.length >= max) break;
    if (creates >= max) break;
    let created: CreatedCandidate;
    try {
      created = await input.create(candidate);
      creates += 1;
    } catch {
      const found = await input.reconcile(candidate);
      if (!found) {
        attempts.push({ candidate, result: "ambiguous", reason: "Create did not confirm. No second shipment was sent." });
        return { accepted: null, attempts, blocked: "SHIPMENT_AMBIGUOUS", creates };
      }
      created = found;
    }
    if (created.possessed) {
      attempts.push({ candidate, result: "stopped", reason: "Carrier may already have the parcel." });
      return { accepted: null, attempts, blocked: "ACTION_REQUIRED_CRITICAL", creates };
    }
    if (!created.awb) {
      const cancelled = await input.cancel(created);
      attempts.push({ candidate, result: cancelled ? "cancelled" : "stopped", reason: "No AWB was returned." });
      if (!cancelled) return { accepted: null, attempts, blocked: "ACTION_REQUIRED_CRITICAL", creates };
      continue;
    }
    const mismatch = destinationRejected(input.canonical, created) || (created.pin != null && created.pin !== input.canonical.pincode);
    if (mismatch) {
      const cancelled = await input.cancel(created);
      attempts.push({
        candidate,
        result: cancelled ? "address_mismatch" : "stopped",
        reason: cancelled ? "Provider destination did not match the order." : "Address mismatch could not be cancelled.",
      });
      if (!cancelled) return { accepted: null, attempts, blocked: "ACTION_REQUIRED_CRITICAL", creates };
      continue;
    }
    if (created.unverified || created.phoneStored === false) {
      const cancelled = await input.cancel(created);
      attempts.push({
        candidate,
        result: cancelled ? "cancelled" : "stopped",
        reason: cancelled ? "Provider destination or phone could not be verified." : "Unverified shipment could not be cancelled.",
      });
      if (!cancelled) return { accepted: null, attempts, blocked: "ACTION_REQUIRED_CRITICAL", creates };
      continue;
    }
    attempts.push({ candidate, result: "accepted", reason: "Address and phone verified." });
    return {
      accepted: {
        ...candidate,
        awb: created.awb,
        labelUrl: created.labelUrl,
        providerShipmentId: created.providerShipmentId,
        providerOrderId: created.providerOrderId,
      },
      attempts,
      blocked: null,
      creates,
    };
  }
  return { accepted: null, attempts, blocked: "AUTO_FULFILLMENT_BLOCKED", creates };
}

export function lockAcquired(updated: { id: string }[] | null | undefined): boolean {
  return Array.isArray(updated) && updated.length === 1;
}

/** A second caller loses while the first lock is younger than the stale window. */
export function lockEligible(lockAt: string | null, nowMs: number, staleMs: number): boolean {
  if (!lockAt) return true;
  const at = Date.parse(lockAt);
  if (!Number.isFinite(at)) return true;
  return nowMs - at >= staleMs;
}
