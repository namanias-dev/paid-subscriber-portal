/**
 * Canonical Indian states and union territories for Notes analytics.
 *
 * Codes are the official GST state codes already used on invoices. Matching is
 * exact after trimming, casing, punctuation and "&" → "and". Known historical
 * names and ISO 3166-2:IN letters are aliases. Nothing is fuzzy-matched, so two
 * different states can never merge. Anything unrecognised is "Unknown".
 */
import { GST_STATE_NAME } from "@/lib/store/invoice/gstin";

export const UNKNOWN_STATE_CODE = "unknown";

export interface CanonicalState {
  code: string;
  name: string;
}

/** Display names. GST names, with the merged UT shortened for tight layouts. */
const DISPLAY: Record<string, string> = {
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "35": "Andaman & Nicobar Islands",
};

export const INDIA_STATES: CanonicalState[] = Object.entries(GST_STATE_NAME)
  .filter(([code]) => code !== "97")
  .map(([code, name]) => ({ code, name: DISPLAY[code] || name }));

const NAME_BY_CODE = new Map(INDIA_STATES.map((row) => [row.code, row.name]));

function key(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES: Record<string, string> = {
  // Historical or official long forms.
  orissa: "21",
  uttaranchal: "05",
  pondicherry: "34",
  "nct of delhi": "07",
  "national capital territory of delhi": "07",
  "new delhi": "07",
  "dadra and nagar haveli": "26",
  "daman and diu": "26",
  "the dadra and nagar haveli and daman and diu": "26",
  "andaman and nicobar": "35",
  "jammu kashmir": "01",
  "j and k": "01",
  // Common exact misspellings seen on Indian address forms.
  chattisgarh: "22",
  chhatisgarh: "22",
  // ISO 3166-2:IN letters (two-letter entries only).
  ap: "37", ar: "12", as: "18", br: "10", ct: "22", cg: "22", ga: "30", gj: "24",
  hr: "06", hp: "02", jh: "20", ka: "29", kl: "32", mp: "23", mh: "27", mn: "14",
  ml: "17", mz: "15", nl: "13", or: "21", od: "21", pb: "03", rj: "08", sk: "11",
  tn: "33", tg: "36", ts: "36", tr: "16", up: "09", ut: "05", uk: "05", wb: "19",
  an: "35", ch: "04", dh: "26", dn: "26", dd: "26", dl: "07", jk: "01", la: "38",
  ld: "31", py: "34",
};

const BY_KEY = new Map<string, string>();
for (const [code, name] of Object.entries(GST_STATE_NAME)) {
  if (code !== "97") BY_KEY.set(key(name), code);
}
for (const [alias, code] of Object.entries(ALIASES)) BY_KEY.set(alias, code);

/** Canonical state for a stored delivery state. Unrecognised input is Unknown, never dropped. */
export function normalizeIndiaState(raw: string | null | undefined): CanonicalState {
  const code = BY_KEY.get(key(String(raw || "")));
  if (!code) return { code: UNKNOWN_STATE_CODE, name: "Unknown" };
  return { code, name: NAME_BY_CODE.get(code) || GST_STATE_NAME[code] };
}

export function stateNameForCode(code: string): string {
  if (code === UNKNOWN_STATE_CODE) return "Unknown";
  return NAME_BY_CODE.get(code) || code;
}

/**
 * Map shape → state codes it represents. The bundled asset predates 2019, so
 * one outline carries Jammu & Kashmir and Ladakh, and two outlines carry the
 * merged Dadra & Nagar Haveli and Daman & Diu.
 */
export const SHAPE_STATES: Record<string, string[]> = {
  an: ["35"], ap: ["37"], ar: ["12"], as: ["18"], br: ["10"], ch: ["04"], ct: ["22"],
  dn: ["26"], dd: ["26"], dl: ["07"], ga: ["30"], gj: ["24"], hr: ["06"], hp: ["02"],
  jk: ["01", "38"], jh: ["20"], ka: ["29"], kl: ["32"], ld: ["31"], mp: ["23"],
  mh: ["27"], mn: ["14"], ml: ["17"], mz: ["15"], nl: ["13"], or: ["21"], py: ["34"],
  pb: ["03"], rj: ["08"], sk: ["11"], tn: ["33"], tg: ["36"], tr: ["16"], up: ["09"],
  ut: ["05"], wb: ["19"],
};

export function shapeLabel(shapeId: string): string {
  const codes = SHAPE_STATES[shapeId] || [];
  if (shapeId === "jk") return "Jammu & Kashmir and Ladakh";
  return codes.map(stateNameForCode).join(" and ") || shapeId;
}
