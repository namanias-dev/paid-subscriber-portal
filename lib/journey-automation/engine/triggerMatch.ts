/**
 * TRIGGER FILTERS (pure). A trigger can narrow which events enrol a contact by
 * matching REAL captured event fields (e.g. only leads from a specific form, only
 * course payments, only a specific webinar). Empty/absent filters mean "all".
 *
 * Only fields the engine can actually read from the event are exposed as filter
 * dimensions — no filter the matcher couldn't evaluate. Used by the matcher to
 * skip non-matching events, and by validation/UI to describe the filter.
 */
import type { AutomationEvent } from "@/types/journey-automation";

export interface TriggerFilterDim {
  /** Config key under trigger config.filters (an array of allowed string values). */
  key: string;
  /** Human label for the UI. */
  label: string;
  /** Helper text for the UI. */
  help: string;
  /** Read the comparable value off an event (null when absent). */
  get: (ev: Pick<AutomationEvent, "payload" | "webinar_id" | "payment_id">) => string | null;
}

function payloadStr(ev: { payload?: Record<string, unknown> | null }, field: string): string | null {
  const v = ev.payload?.[field];
  return v == null ? null : String(v);
}

/**
 * The filter dimensions available per captured event type. Each maps to a field
 * the ingestion actually writes (see lib/analytics/server.ts, dataProvider.ts,
 * app/api/cron/sms-dispatch/route.ts).
 */
export const TRIGGER_FILTER_DIMS: Record<string, TriggerFilterDim[]> = {
  lead_created: [
    { key: "sourceForm", label: "Lead source form", help: "Only enrol leads from the selected form(s).", get: (ev) => payloadStr(ev, "source_form") },
  ],
  payment_received: [
    { key: "itemType", label: "Product type", help: "Only enrol for the selected product type(s) (course / webinar).", get: (ev) => payloadStr(ev, "item_type") },
    { key: "itemSlug", label: "Specific product", help: "Only enrol for the selected product(s).", get: (ev) => payloadStr(ev, "item_slug") },
  ],
  installment_overdue: [
    { key: "courseId", label: "Course / plan", help: "Only enrol for overdue installments on the selected course(s).", get: (ev) => payloadStr(ev, "course_id") },
  ],
  webinar_registered: [
    { key: "webinarId", label: "Webinar", help: "Only enrol registrations for the selected webinar(s).", get: (ev) => (ev.webinar_id == null ? null : String(ev.webinar_id)) },
  ],
};

export type TriggerFilters = Record<string, string[] | undefined>;

/** A selectable filter value (client-safe shape shared with the live-sources API). */
export interface TriggerSourceOption {
  value: string;
  label: string;
  /** Times observed in recent events (0 = registered but not yet seen). */
  count: number;
}

/** { eventType: { dimKey: TriggerSourceOption[] } } — the live sources payload. */
export type TriggerSources = Record<string, Record<string, TriggerSourceOption[]>>;

/** Read a normalised filters object off a trigger node config. */
export function readTriggerFilters(config: Record<string, unknown> | null | undefined): TriggerFilters {
  const raw = config?.["filters"];
  if (!raw || typeof raw !== "object") return {};
  const out: TriggerFilters = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      const vals = v.map((x) => String(x)).filter((x) => x.trim() !== "");
      if (vals.length) out[k] = vals;
    }
  }
  return out;
}

/**
 * Does this event match the trigger's filters? Every configured dimension must
 * match (AND across dimensions, OR within a dimension's allowed values). A
 * dimension with no configured values is "all" and is ignored.
 */
export function eventMatchesTrigger(
  eventType: string,
  config: Record<string, unknown> | null | undefined,
  ev: Pick<AutomationEvent, "payload" | "webinar_id" | "payment_id">,
): boolean {
  const dims = TRIGGER_FILTER_DIMS[eventType] ?? [];
  if (!dims.length) return true;
  const filters = readTriggerFilters(config);
  for (const dim of dims) {
    const allowed = filters[dim.key];
    if (!allowed || allowed.length === 0) continue; // "all" for this dimension
    const val = dim.get(ev);
    if (val == null) return false;
    if (!allowed.includes(val)) return false;
  }
  return true;
}

/** A short human summary of the active filters (for the node + validation). */
export function summarizeTriggerFilters(
  eventType: string,
  config: Record<string, unknown> | null | undefined,
  labelFor?: (dimKey: string, value: string) => string,
): string {
  const dims = TRIGGER_FILTER_DIMS[eventType] ?? [];
  const filters = readTriggerFilters(config);
  const parts: string[] = [];
  for (const dim of dims) {
    const allowed = filters[dim.key];
    if (!allowed || allowed.length === 0) continue;
    const labels = allowed.map((v) => (labelFor ? labelFor(dim.key, v) : v));
    parts.push(`${dim.label}: ${labels.join(", ")}`);
  }
  return parts.length ? parts.join(" · ") : "All sources";
}
