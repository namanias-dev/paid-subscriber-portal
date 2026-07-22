/**
 * Thin wrapper over `googleapis` for the legacy-lead importer + Phase 2B sync
 * route. Server-only — never imported by client code (googleapis is huge and has
 * no browser build). The one-and-only place we deal with the Google Sheets API.
 *
 * Auth: JSON service-account credentials, loaded from either
 *   - `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` env var (single-line JSON or base64),
 *   - a local file path (dry-run only), passed via CLI flag.
 * The service-account key value is NEVER logged, printed, or persisted to the
 * workspace.
 */

import { readFileSync } from "node:fs";
import type { sheets_v4 } from "googleapis";
import { google } from "googleapis";

/** Minimum readable shape of a Google service-account key JSON. */
export interface ServiceAccountCredential {
  type: "service_account";
  project_id: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  token_uri?: string;
}

const READ_SCOPE = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

/** Type-guard for the smallest set of fields we need to authenticate. */
function isServiceAccountCredential(x: unknown): x is ServiceAccountCredential {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    r.type === "service_account" &&
    typeof r.project_id === "string" &&
    typeof r.private_key === "string" &&
    typeof r.client_email === "string"
  );
}

/**
 * Resolve service-account credentials from either an explicit local path (dry-run
 * only), the standard env var, or the base64-encoded variant. Returns a live
 * `JWT` client on success and throws otherwise. Never logs the JSON body.
 */
export function loadServiceAccountAuth(opts?: { path?: string }): {
  auth: InstanceType<typeof google.auth.JWT>;
  clientEmail: string;
  projectId: string;
} {
  let raw: string | null = null;
  let sourceLabel = "";
  if (opts?.path) {
    raw = readFileSync(opts.path, "utf-8");
    sourceLabel = "path";
  } else {
    const envRaw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON;
    if (!envRaw) {
      throw new Error(
        "GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON not set (or use --service-account-path=<file> for a local dry-run). Never commit the file.",
      );
    }
    // Accept either a single-line JSON or base64-encoded JSON.
    if (envRaw.trim().startsWith("{")) {
      raw = envRaw;
      sourceLabel = "env-json";
    } else {
      raw = Buffer.from(envRaw, "base64").toString("utf-8");
      sourceLabel = "env-b64";
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse service-account JSON from ${sourceLabel} — invalid JSON.`);
  }
  if (!isServiceAccountCredential(parsed)) {
    throw new Error(`Service-account JSON from ${sourceLabel} is missing required fields.`);
  }
  const auth = new google.auth.JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: READ_SCOPE,
  });
  return { auth, clientEmail: parsed.client_email, projectId: parsed.project_id };
}

/** Return a bound Sheets v4 client — pass the JWT resolved above. */
export function makeSheetsClient(auth: InstanceType<typeof google.auth.JWT>): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth });
}

/**
 * Fetch every non-empty row from a sheet tab and return them keyed by header row.
 * Uses the whole-tab notation `<Tab>!A:ZZ`. The Google Sheets API returns rows
 * as arrays; we pair them with the first row's headers here so downstream code
 * can index by column name.
 *
 * Returns [] when the tab has no data (headers only).
 */
export async function fetchTabAsRecords(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<Array<Record<string, string | null>>> {
  const range = `'${tabName.replace(/'/g, "''")}'!A:ZZ`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const values: unknown[][] = Array.isArray(resp.data.values) ? (resp.data.values as unknown[][]) : [];
  if (values.length < 2) return [];
  const rawHeaders = values[0].map((h) => (typeof h === "string" ? h : String(h ?? "")).trim());
  // Preserve duplicates by disambiguating: "Phone No." (first) beats "Phone No. (2)".
  const seen = new Map<string, number>();
  const headers: string[] = rawHeaders.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h} (${n + 1})`;
  });
  const rows: Array<Record<string, string | null>> = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] ?? [];
    const rec: Record<string, string | null> = {};
    let hasAny = false;
    for (let j = 0; j < headers.length; j++) {
      const v = row[j];
      const s = v === null || v === undefined || v === "" ? null : typeof v === "string" ? v : String(v);
      rec[headers[j]] = s;
      if (s !== null) hasAny = true;
    }
    if (hasAny) rows.push(rec);
  }
  return rows;
}
