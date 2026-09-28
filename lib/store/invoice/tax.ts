/**
 * Invoice tax math. Integer paise only.
 * Notes prices are tax-inclusive unless the invoice settings say exclusive.
 * Exempt and nil lines contribute no tax. Rates come from the product snapshot.
 */

export type TaxTreatment = "exempt" | "nil" | "taxable";

export interface TaxLineInput {
  name: string;
  sku: string | null;
  hsn: string | null;
  qty: number;
  unit?: string | null;
  taxConfigurationStatus?: string | null;
  /** Customer line total after discount, in paise. */
  lineTotalPaise: number;
  discountPaise: number;
  taxTreatment: string;
  taxRateBps: number;
}

export interface TaxLine {
  name: string;
  sku: string | null;
  hsn: string | null;
  qty: number;
  unit: string;
  unitPaise: number;
  discountPaise: number;
  taxablePaise: number;
  rateBps: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export interface TaxDocument {
  lines: TaxLine[];
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  utgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  roundingPaise: number;
  grandTotalPaise: number;
  interstate: boolean;
  anyTaxable: boolean;
}

/** Union territories without a legislature. Local tax is UTGST, not SGST. */
const UTGST_STATE_CODES = new Set(["04", "26", "31", "35", "38"]);

export function localTaxKind(supplierStateCode: string | null, interstate: boolean): "IGST" | "UTGST" | "SGST" {
  if (interstate) return "IGST";
  if (UTGST_STATE_CODES.has((supplierStateCode || "").trim())) return "UTGST";
  return "SGST";
}

export function splitTax(
  taxPaise: number,
  interstate: boolean,
  supplierStateCode: string | null = null,
): { cgst: number; sgst: number; utgst: number; igst: number } {
  const tax = Math.max(0, Math.round(taxPaise));
  if (!tax) return { cgst: 0, sgst: 0, utgst: 0, igst: 0 };
  if (interstate) return { cgst: 0, sgst: 0, utgst: 0, igst: tax };
  const cgst = Math.floor(tax / 2);
  const local = tax - cgst;
  if (localTaxKind(supplierStateCode, false) === "UTGST") return { cgst, sgst: 0, utgst: local, igst: 0 };
  return { cgst, sgst: local, utgst: 0, igst: 0 };
}

/** Tax embedded in an inclusive amount, or added on an exclusive amount. */
export function taxOnAmount(amountPaise: number, treatment: string, rateBps: number, inclusive: boolean): number {
  if (treatment !== "taxable" || rateBps <= 0 || amountPaise <= 0) return 0;
  if (inclusive) return Math.round((amountPaise * rateBps) / (10_000 + rateBps));
  return Math.round((amountPaise * rateBps) / 10_000);
}

export function computeTaxDocument(input: {
  lines: TaxLineInput[];
  shippingPaise: number;
  pricesIncludeTax: boolean;
  supplierStateCode: string | null;
  placeOfSupplyCode: string | null;
  chargedTotalPaise: number;
}): TaxDocument {
  const supplier = (input.supplierStateCode || "").trim();
  const place = (input.placeOfSupplyCode || "").trim();
  const interstate = Boolean(supplier && place && supplier !== place);
  const lines: TaxLine[] = input.lines.map((line) => {
    const qty = Math.max(1, Math.round(line.qty || 1));
    const total = Math.max(0, Math.round(line.lineTotalPaise || 0));
    const tax = taxOnAmount(total, line.taxTreatment, line.taxRateBps, input.pricesIncludeTax);
    const split = splitTax(tax, interstate, supplier);
    const taxable = input.pricesIncludeTax ? total - tax : total;
    return {
      name: line.name,
      sku: line.sku,
      hsn: line.hsn,
      qty,
      unit: line.unit || "NOS",
      unitPaise: Math.round((total + Math.max(0, Math.round(line.discountPaise || 0))) / qty),
      discountPaise: Math.max(0, Math.round(line.discountPaise || 0)),
      taxablePaise: taxable,
      rateBps: line.taxTreatment === "taxable" ? line.taxRateBps : 0,
      cgstPaise: split.cgst,
      sgstPaise: split.sgst,
      utgstPaise: split.utgst,
      igstPaise: split.igst,
      taxPaise: tax,
      totalPaise: input.pricesIncludeTax ? total : total + tax,
    };
  });
  const subtotal = lines.reduce((n, line) => n + line.totalPaise + (input.pricesIncludeTax ? 0 : 0), 0);
  const discount = lines.reduce((n, line) => n + line.discountPaise, 0);
  const shipping = Math.max(0, Math.round(input.shippingPaise || 0));
  const goods = lines.reduce((n, line) => n + (input.pricesIncludeTax ? line.totalPaise : line.totalPaise), 0);
  const computed = goods + (input.pricesIncludeTax ? shipping : shipping);
  const charged = Math.max(0, Math.round(input.chargedTotalPaise || computed));
  const rounding = charged - computed;
  return {
    lines,
    subtotalPaise: lines.reduce((n, line) => n + line.taxablePaise + line.taxPaise, 0),
    discountPaise: discount,
    shippingPaise: shipping,
    taxablePaise: lines.reduce((n, line) => n + line.taxablePaise, 0),
    cgstPaise: lines.reduce((n, line) => n + line.cgstPaise, 0),
    sgstPaise: lines.reduce((n, line) => n + line.sgstPaise, 0),
    utgstPaise: lines.reduce((n, line) => n + line.utgstPaise, 0),
    igstPaise: lines.reduce((n, line) => n + line.igstPaise, 0),
    taxPaise: lines.reduce((n, line) => n + line.taxPaise, 0),
    roundingPaise: rounding,
    grandTotalPaise: charged,
    interstate,
    anyTaxable: lines.some((line) => line.rateBps > 0),
  };
}

export type DocumentType = "TAX_INVOICE" | "BILL_OF_SUPPLY" | "INVOICE";

/** Production issuance needs an explicit confirmed nil or taxable HSN. Exempt placeholders stay blocked. */
export function taxClassificationConfirmed(lines: { hsn: string | null; taxTreatment?: string | null; taxConfigurationStatus?: string | null }[]): boolean {
  return lines.length > 0 && lines.every((line) => {
    const treatment = (line.taxTreatment || "").toLowerCase();
    return (
      line.taxConfigurationStatus === "CONFIRMED" &&
      (treatment === "nil" || treatment === "taxable") &&
      /^\d{4,8}$/.test((line.hsn || "").trim())
    );
  });
}

export function chooseDocumentType(input: {
  gstin: string | null;
  anyTaxable: boolean;
  requested?: string | null;
}): { type: DocumentType; attention: string | null } {
  const gstin = (input.gstin || "").trim();
  const requested = (input.requested || "auto").toUpperCase();
  if (requested === "TAX_INVOICE") {
    if (!gstin) return { type: "INVOICE", attention: "GSTIN is not configured, so this is not issued as a tax invoice." };
    return { type: "TAX_INVOICE", attention: null };
  }
  if (requested === "BILL_OF_SUPPLY") return { type: "BILL_OF_SUPPLY", attention: null };
  if (requested === "INVOICE") return { type: "INVOICE", attention: null };
  if (input.anyTaxable && gstin) return { type: "TAX_INVOICE", attention: null };
  if (input.anyTaxable && !gstin) return { type: "INVOICE", attention: "A taxable product is missing a configured GSTIN." };
  return { type: "BILL_OF_SUPPLY", attention: null };
}

const STATE_CODES: Record<string, string> = {
  "jammu and kashmir": "01",
  "himachal pradesh": "02",
  punjab: "03",
  chandigarh: "04",
  uttarakhand: "05",
  haryana: "06",
  delhi: "07",
  rajasthan: "08",
  "uttar pradesh": "09",
  bihar: "10",
  sikkim: "11",
  "arunachal pradesh": "12",
  nagaland: "13",
  manipur: "14",
  mizoram: "15",
  tripura: "16",
  meghalaya: "17",
  assam: "18",
  "west bengal": "19",
  jharkhand: "20",
  odisha: "21",
  orissa: "21",
  chhattisgarh: "22",
  "madhya pradesh": "23",
  gujarat: "24",
  maharashtra: "27",
  karnataka: "29",
  goa: "30",
  kerala: "32",
  "tamil nadu": "33",
  telangana: "36",
  "andhra pradesh": "37",
};

export function stateCodeFromName(state: string | null | undefined): string | null {
  const key = String(state || "").trim().toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ");
  return STATE_CODES[key] || null;
}

export function amountInWords(paise: number): string {
  const safe = Math.max(0, Math.round(paise));
  const rupees = Math.floor(safe / 100);
  const rest = safe % 100;
  const rupeeWords = titleCase(indianNumberWords(rupees));
  if (!rest) return `INR ${rupeeWords} Only`;
  return `INR ${rupeeWords} and ${titleCase(underHundred(rest))} Paise Only`;
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function underHundred(v: number): string {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (v < 20) return ones[v] || "zero";
  return `${tens[Math.floor(v / 10)]}${v % 10 ? `-${ones[v % 10]}` : ""}`;
}

function indianNumberWords(n: number): string {
  if (n === 0) return "zero";
  const chunk = (v: number): string => {
    if (v < 100) return underHundred(v);
    const hundreds = Math.floor(v / 100);
    const rest = v % 100;
    const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    return `${ones[hundreds]} hundred${rest ? ` ${underHundred(rest)}` : ""}`;
  };
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = n % 1000;
  if (crore) parts.push(`${chunk(crore)} crore`);
  if (lakh) parts.push(`${chunk(lakh)} lakh`);
  if (thousand) parts.push(`${chunk(thousand)} thousand`);
  if (hundred) parts.push(chunk(hundred));
  return parts.join(" ").replace(/\s+/g, " ");
}
