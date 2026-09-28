export interface RegisteredAddressInput {
  floorDisplay?: string | null;
  building?: string | null;
  sector?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

function clean(value: string | null | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titlePlace(value: string): string {
  if (!value) return "";
  if (value === value.toUpperCase() && /[A-Z]/.test(value)) {
    return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  return value;
}

/** Certificate spellings that must not be printed. The raw value stays in audit metadata. */
const FLOOR_DISPLAY: Record<string, string> = {
  "SECOUND FLOOR": "Second Floor",
};

/** Split a certificate floor string into the stored raw text and the customer-facing spelling. */
export function normalizeCertificateFloor(raw: string | null | undefined): { raw: string | null; display: string | null } {
  const cleaned = clean(raw);
  if (!cleaned) return { raw: null, display: null };
  return { raw: cleaned, display: FLOOR_DISPLAY[cleaned.toUpperCase()] || cleaned };
}

/** Customer-facing seller address. Display floor is never the raw certificate spelling. */
export function formatRegisteredAddress(input: RegisteredAddressInput): string[] {
  const floor = normalizeCertificateFloor(input.floorDisplay).display || "";
  const building = clean(input.building);
  const sectorRaw = clean(input.sector);
  const sector = sectorRaw && !/^sector\b/i.test(sectorRaw) ? `Sector ${sectorRaw}` : sectorRaw;
  const city = titlePlace(clean(input.city));
  const state = titlePlace(clean(input.state));
  const pin = clean(input.pincode);
  const line1 = [floor, building].filter(Boolean).join(", ");
  const line2 = [sector, city].filter(Boolean).join(", ");
  const samePlace = city && state && city.toLowerCase() === state.toLowerCase();
  const place = samePlace ? city : [city, state].filter(Boolean).join(", ");
  const line3 = [place, pin].filter(Boolean).join(" ");
  return [line1, line2, line3 ? `${line3}, India` : ""].filter(Boolean);
}
