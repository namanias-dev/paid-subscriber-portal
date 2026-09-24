/** Product package profile. Shipping never guesses dimensions from a product name. */

export const STANDARD_NOTES_PRICE_PAISE = 299_900;

export type PackageSource = "PRODUCT_PROFILE" | "STAFF_OVERRIDE";

export interface PackageProfile {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export function packageProfileReady(input: {
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
}): boolean {
  return Boolean(input.weightGrams && input.lengthMm && input.widthMm && input.heightMm);
}

export function packageFromProduct(input: {
  weightGrams?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
}): PackageProfile | null {
  if (!packageProfileReady(input)) return null;
  return {
    weightGrams: Number(input.weightGrams),
    lengthCm: Number(input.lengthMm) / 10,
    widthCm: Number(input.widthMm) / 10,
    heightCm: Number(input.heightMm) / 10,
  };
}

/** A saved shipment package stays put when the product profile later changes. */
export function freezePackageSnapshot(profile: PackageProfile, source: PackageSource): PackageProfile & { source: PackageSource } {
  return {
    weightGrams: profile.weightGrams,
    lengthCm: profile.lengthCm,
    widthCm: profile.widthCm,
    heightCm: profile.heightCm,
    source,
  };
}

export function validateProductPackage(input: {
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
}): string | null {
  const values = [input.weightGrams, input.lengthMm, input.widthMm, input.heightMm];
  const present = values.filter((n) => n != null);
  if (!present.length) return null;
  if (present.length !== 4) return "Enter weight, length, width and height together.";
  if (!input.weightGrams || input.weightGrams < 50 || input.weightGrams > 30000) {
    return "Packed weight must be between 50 g and 30 kg.";
  }
  for (const [label, mm] of [
    ["Length", input.lengthMm],
    ["Width", input.widthMm],
    ["Height", input.heightMm],
  ] as const) {
    const cm = Number(mm) / 10;
    if (!mm || cm < 0.5 || cm > 200) return `${label} must be between 0.5 cm and 200 cm.`;
  }
  return null;
}

export function formatPackageSummary(profile: PackageProfile | null): string {
  if (!profile) return "Package profile required";
  return `${profile.weightGrams} g · ${profile.lengthCm} × ${profile.widthCm} × ${profile.heightCm} cm`;
}
