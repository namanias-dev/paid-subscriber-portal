/**
 * Billable courier calls. Every function here checks the write gate before
 * any network request. Production leaves that gate unset.
 * A successful create stores an AWB. It does not mark the order shipped.
 */
import { delhiveryBaseUrl, delhiveryPickupLocation, delhiveryToken, shiprocketBaseUrl, shiprocketPickupLocation } from "./config";
import { delhiveryCreateBody, dispatchBlocked, type DelhiveryShipmentDraft } from "./dispatch";
import { delhiveryPackingSlipPath } from "./delhiveryApi";
import { shiprocketAdhocDraft, shiprocketToken } from "./shiprocketApi";

type FetchLike = typeof fetch;

export interface BookParty {
  orderNumber: string;
  name: string;
  address: string;
  pin: string;
  city: string;
  state: string;
  phone: string;
  product: string;
  amountRupees: number;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface CreateProviderInput extends BookParty {
  provider: "shiprocket" | "delhivery";
  courierId?: string | null;
}

export interface CreatedShipment {
  provider: "shiprocket" | "delhivery";
  providerShipmentId: string | null;
  providerOrderId: string | null;
  awb: string | null;
  courierName: string | null;
  labelUrl: string | null;
  shipmentStatus: "created";
  /** Set only when the provider actually returned an AWB. */
  orderStatus: "READY_FOR_PICKUP" | null;
}

function record(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function assertWrites(env: NodeJS.ProcessEnv): void {
  const blocked = dispatchBlocked(env);
  if (blocked) throw new Error(blocked);
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

export function parseShiprocketCreate(body: unknown): {
  shipmentId: string | null;
  orderId: string | null;
  awb: string | null;
  courierName: string | null;
  message: string | null;
} {
  const root = record(body);
  const payload = record(root?.payload) || root;
  const awb = str(payload?.awb_code);
  return {
    shipmentId: str(payload?.shipment_id) || null,
    orderId: str(payload?.order_id) || null,
    awb: awb || null,
    courierName: str(payload?.courier_name) || null,
    message: str(root?.message) || null,
  };
}

export function parseShiprocketAwbAssign(body: unknown): { awb: string | null; courierName: string | null } {
  const root = record(body);
  const data = record(record(root?.response)?.data) || record(root?.response) || root;
  const awb = str(data?.awb_code);
  return { awb: awb || null, courierName: str(data?.courier_name) || null };
}

export function parseShiprocketLabel(body: unknown): string | null {
  const url = str(record(body)?.label_url);
  return url || null;
}

export function parseShiprocketPickup(body: unknown): { reference: string | null; date: string | null } {
  const response = record(record(body)?.response) || record(body);
  return {
    reference: str(response?.pickup_token_number) || null,
    date: str(response?.pickup_scheduled_date) || null,
  };
}

export function parseDelhiveryCreate(body: unknown): { awb: string | null; remark: string | null } {
  const root = record(body);
  const row = Array.isArray(root?.packages) ? record(root.packages[0]) : null;
  const remarks = row?.remarks;
  const remark = Array.isArray(remarks) ? remarks.map(str).filter(Boolean).join(" ") : str(remarks) || str(root?.rmk);
  const awb = str(row?.waybill);
  return { awb: awb || null, remark: remark || null };
}

export function parseDelhiveryLabel(body: unknown): string | null {
  const root = record(body);
  const direct = str(root?.pdf_download_link) || str(root?.label_url);
  if (direct) return direct;
  const packages = root?.packages;
  const row = Array.isArray(packages) ? record(packages[0]) : null;
  const nested = str(row?.pdf_download_link) || str(row?.pdf_encoding);
  return nested.startsWith("http") ? nested : null;
}

function draftOf(input: BookParty, paymentMode: "Prepaid" | "Pickup"): DelhiveryShipmentDraft {
  return {
    pickupName: "",
    orderNo: input.orderNumber,
    name: input.name,
    address: input.address,
    pin: input.pin,
    city: input.city,
    state: input.state,
    phone: input.phone,
    product: input.product,
    amountRupees: input.amountRupees,
    weightGrams: input.weightGrams,
    lengthCm: input.lengthCm,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
    paymentMode,
  };
}

export async function createProviderShipment(
  input: CreateProviderInput,
  opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<CreatedShipment> {
  const env = opts.env || process.env;
  assertWrites(env);
  const fetchImpl = opts.fetchImpl || fetch;
  if (input.provider === "delhivery") return createDelhivery(input, env, fetchImpl);
  return createShiprocket(input, env, fetchImpl);
}

async function createDelhivery(input: CreateProviderInput, env: NodeJS.ProcessEnv, fetchImpl: FetchLike): Promise<CreatedShipment> {
  const token = delhiveryToken(env);
  const pickupName = delhiveryPickupLocation(env);
  if (!token) throw new Error("Delhivery API token is not set.");
  if (!pickupName) throw new Error("Delhivery pickup location name is not set.");
  const body = delhiveryCreateBody({ ...draftOf(input, "Prepaid"), pickupName });
  const res = await fetchImpl(`${delhiveryBaseUrl(env)}/api/cmu/create.json`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Token ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "NamanIAS-NotesStore/1.0",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const parsed = parseDelhiveryCreate(await readJson(res));
  if (!res.ok || !parsed.awb) {
    throw new Error((parsed.remark || `Delhivery shipment was not created (${res.status}).`).slice(0, 180));
  }
  return {
    provider: "delhivery",
    providerShipmentId: parsed.awb,
    providerOrderId: input.orderNumber,
    awb: parsed.awb,
    courierName: "Delhivery",
    labelUrl: null,
    shipmentStatus: "created",
    orderStatus: "READY_FOR_PICKUP",
  };
}

async function createShiprocket(input: CreateProviderInput, env: NodeJS.ProcessEnv, fetchImpl: FetchLike): Promise<CreatedShipment> {
  const pickup = shiprocketPickupLocation(env);
  if (!pickup) throw new Error("Shiprocket pickup nickname is not set.");
  const token = await shiprocketToken({ fetchImpl, env });
  const draft = shiprocketAdhocDraft({
    pickupLocation: pickup,
    orderNumber: input.orderNumber,
    name: input.name,
    address: input.address,
    pin: input.pin,
    city: input.city,
    state: input.state,
    phone: input.phone,
    product: input.product,
    amountRupees: input.amountRupees,
    weightKg: input.weightGrams / 1000,
    lengthCm: input.lengthCm,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
  });
  const base = shiprocketBaseUrl(env);
  const createdRes = await fetchImpl(`${base}/orders/create/adhoc`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...draft, order_date: new Date().toISOString().slice(0, 16).replace("T", " ") }),
    signal: AbortSignal.timeout(20_000),
  });
  const created = parseShiprocketCreate(await readJson(createdRes));
  if (!createdRes.ok || !created.shipmentId) {
    throw new Error((created.message || `Shiprocket order was not created (${createdRes.status}).`).slice(0, 180));
  }
  let awb = created.awb;
  let courierName = created.courierName;
  const courierId = (input.courierId || "").trim();
  if (!awb && courierId) {
    const assignRes = await fetchImpl(`${base}/courier/assign/awb`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shipment_id: created.shipmentId, courier_id: courierId }),
      signal: AbortSignal.timeout(20_000),
    });
    const assigned = parseShiprocketAwbAssign(await readJson(assignRes));
    if (assignRes.ok && assigned.awb) {
      awb = assigned.awb;
      courierName = assigned.courierName || courierName;
    }
  }
  let labelUrl: string | null = null;
  if (awb) {
    const labelRes = await fetchImpl(`${base}/courier/generate/label`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shipment_id: [created.shipmentId] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (labelRes.ok) labelUrl = parseShiprocketLabel(await readJson(labelRes));
  }
  return {
    provider: "shiprocket",
    providerShipmentId: created.shipmentId,
    providerOrderId: created.orderId,
    awb,
    courierName,
    labelUrl,
    shipmentStatus: "created",
    orderStatus: awb ? "READY_FOR_PICKUP" : null,
  };
}

export async function requestProviderPickup(
  input: {
    provider: "shiprocket" | "delhivery";
    providerShipmentId?: string | null;
    date: string;
    packageCount?: number;
  },
  opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<{ reference: string | null; date: string }> {
  const env = opts.env || process.env;
  assertWrites(env);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Pickup date must be YYYY-MM-DD.");
  const fetchImpl = opts.fetchImpl || fetch;
  if (input.provider === "shiprocket") {
    const shipmentId = (input.providerShipmentId || "").trim();
    if (!shipmentId) throw new Error("Shiprocket shipment id is missing.");
    const token = await shiprocketToken({ fetchImpl, env });
    const res = await fetchImpl(`${shiprocketBaseUrl(env)}/courier/generate/pickup`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shipment_id: [shipmentId] }),
      signal: AbortSignal.timeout(20_000),
    });
    const parsed = parseShiprocketPickup(await readJson(res));
    if (!res.ok) throw new Error("Shiprocket pickup was not scheduled.");
    return { reference: parsed.reference, date: parsed.date || input.date };
  }
  const token = delhiveryToken(env);
  const pickupName = delhiveryPickupLocation(env);
  if (!token || !pickupName) throw new Error("Delhivery pickup is not configured.");
  const res = await fetchImpl(`${delhiveryBaseUrl(env)}/fm/request/new/`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
      "User-Agent": "NamanIAS-NotesStore/1.0",
    },
    body: JSON.stringify({
      pickup_location: pickupName,
      pickup_date: input.date,
      pickup_time: "10:00:00",
      expected_package_count: input.packageCount || 1,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = record(await readJson(res));
  if (!res.ok) throw new Error((str(body?.error) || str(body?.message) || "Delhivery pickup was not scheduled.").slice(0, 180));
  const reference = str(body?.pickup_id) || str(body?.pr_id) || null;
  return { reference, date: input.date };
}

export async function cancelProviderShipment(
  input: { provider: "shiprocket" | "delhivery"; providerOrderId?: string | null; awb?: string | null },
  opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  const env = opts.env || process.env;
  assertWrites(env);
  const fetchImpl = opts.fetchImpl || fetch;
  if (input.provider === "shiprocket") {
    const orderId = (input.providerOrderId || "").trim();
    if (!orderId) throw new Error("Shiprocket order id is missing.");
    const token = await shiprocketToken({ fetchImpl, env });
    const res = await fetchImpl(`${shiprocketBaseUrl(env)}/orders/cancel`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids: [orderId] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error("Shiprocket cancellation was not accepted.");
    return;
  }
  const token = delhiveryToken(env);
  const awb = (input.awb || "").trim();
  if (!token || !awb) throw new Error("Delhivery waybill is missing.");
  const res = await fetchImpl(`${delhiveryBaseUrl(env)}/api/p/edit`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
      "User-Agent": "NamanIAS-NotesStore/1.0",
    },
    body: JSON.stringify({ waybill: awb, cancellation: "true" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error("Delhivery cancellation was not accepted.");
}

/** Delhivery reverse pickup. Shiprocket returns are not posted from this deploy. */
export async function requestReverseShipment(
  input: BookParty & { provider: "shiprocket" | "delhivery" },
  opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<{ awb: string | null }> {
  const env = opts.env || process.env;
  assertWrites(env);
  if (input.provider !== "delhivery") {
    throw new Error("A Shiprocket reverse shipment is not called from this deploy.");
  }
  const token = delhiveryToken(env);
  const pickupName = delhiveryPickupLocation(env);
  if (!token || !pickupName) throw new Error("Delhivery reverse pickup is not configured.");
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(`${delhiveryBaseUrl(env)}/api/cmu/create.json`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Token ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "NamanIAS-NotesStore/1.0",
    },
    body: delhiveryCreateBody({ ...draftOf(input, "Pickup"), pickupName }),
    signal: AbortSignal.timeout(20_000),
  });
  const parsed = parseDelhiveryCreate(await readJson(res));
  if (!res.ok || !parsed.awb) throw new Error((parsed.remark || "Delhivery reverse pickup was not created.").slice(0, 180));
  return { awb: parsed.awb };
}

/**
 * Label for a shipment that already exists. A stored URL is returned with no
 * network call. Delhivery uses the packing-slip read. This never creates an order.
 */
export async function fetchExistingLabel(
  input: { provider: "shiprocket" | "delhivery" | "manual"; awb?: string | null; storedLabelUrl?: string | null },
  opts: { fetchImpl?: FetchLike; env?: NodeJS.ProcessEnv } = {},
): Promise<{ url: string | null }> {
  const stored = (input.storedLabelUrl || "").trim();
  if (stored) return { url: stored };
  if (input.provider !== "delhivery") return { url: null };
  const awb = (input.awb || "").trim();
  if (!awb) return { url: null };
  const env = opts.env || process.env;
  const token = delhiveryToken(env);
  if (!token) return { url: null };
  const fetchImpl = opts.fetchImpl || fetch;
  const path = delhiveryPackingSlipPath(awb);
  const res = await fetchImpl(`${delhiveryBaseUrl(env)}${path}`, {
    headers: { Accept: "application/json", Authorization: `Token ${token}`, "User-Agent": "NamanIAS-NotesStore/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { url: null };
  return { url: parseDelhiveryLabel(await readJson(res)) };
}
