/** Client-safe shapes and formatters for the admin orders operations summary. */
import type { StageProgress } from "./opsBoard";

export type PackageDisplaySource = "BOOKED_SHIPMENT" | "ORDER_PACKAGE" | "PRODUCT_PROFILE";

export interface PackageDisplay {
  weight_grams: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  source: PackageDisplaySource;
}

export interface OrderOps {
  stage: StageProgress | null;
  city: string | null;
  state: string | null;
  courier: string | null;
  provider: string | null;
  rate_paise: number | null;
  courier_not_selected: boolean;
  pickup_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  latest_text: string | null;
  latest_at: string | null;
  package: PackageDisplay | null;
  issue: string | null;
}

export interface ShippingRateStats {
  count: number;
  avg_paise: number | null;
  min_paise: number | null;
  max_paise: number | null;
  unknown: number;
}

export const PACKAGE_SOURCE_LABEL: Record<PackageDisplaySource, string> = {
  BOOKED_SHIPMENT: "Booked shipment",
  ORDER_PACKAGE: "Order package",
  PRODUCT_PROFILE: "Product profile",
};

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

export function formatPackageWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${grams} g`;
}

export function formatPackageDims(pkg: Pick<PackageDisplay, "length_cm" | "width_cm" | "height_cm">): string {
  return `${trimNumber(pkg.length_cm)}×${trimNumber(pkg.width_cm)}×${trimNumber(pkg.height_cm)} cm`;
}
