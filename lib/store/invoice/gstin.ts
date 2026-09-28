const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Official GST state codes (GSTIN first two digits).
 * 04 is Chandigarh. Source: GSTN state-code list used on GST REG-06.
 */
export const GST_STATE_NAME: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export function gstinStateCode(gstin: string): string | null {
  const code = gstin.trim().toUpperCase().slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

export function gstinPan(gstin: string): string | null {
  const pan = gstin.trim().toUpperCase().slice(2, 12);
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? pan : null;
}

/** Structural GSTIN check, including the official modulus-36 check character. */
export function validateGstin(value: string): { ok: true; gstin: string; stateCode: string; pan: string } | { ok: false; error: string } {
  const gstin = value.trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return { ok: false, error: "GSTIN format is not valid." };
  }
  const expected = gstinCheckCharacter(gstin.slice(0, 14));
  if (gstin[14] !== expected) return { ok: false, error: "GSTIN check character does not match." };
  const stateCode = gstin.slice(0, 2);
  if (!GST_STATE_NAME[stateCode]) return { ok: false, error: "GSTIN state code is not a known GST state." };
  return { ok: true, gstin, stateCode, pan: gstin.slice(2, 12) };
}

function gstinCheckCharacter(first14: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i -= 1) {
    const code = ALPHABET.indexOf(first14[i] || "");
    let product = code * factor;
    factor = factor === 2 ? 1 : 2;
    product = Math.floor(product / 36) + (product % 36);
    sum += product;
  }
  return ALPHABET[(36 - (sum % 36)) % 36] || "";
}
