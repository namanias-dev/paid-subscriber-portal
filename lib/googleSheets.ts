/**
 * Google Sheets question import.
 *
 * Zero-cost path (default): the sheet is shared as "Anyone with the link can
 * view" (or Published to the web). We read its CSV export — no credentials.
 *
 * Private sheets (TODO): set GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY
 * / GOOGLE_SHEETS_PROJECT_ID and use a service account. Left as a documented
 * follow-up so we don't add a paid dependency or block the build without creds.
 */

export function parseSheetId(input: string): string {
  const m = String(input || "").match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(input || "").trim();
}

export function parseGid(input: string): string | null {
  const m = String(input || "").match(/[#&?]gid=([0-9]+)/);
  return m ? m[1] : null;
}

export function sheetCsvUrl(spreadsheetId: string, gid?: string | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`;
  return gid ? `${base}&gid=${gid}` : base;
}

export const SHEETS_SERVICE_ACCOUNT_CONFIGURED =
  !!process.env.GOOGLE_SHEETS_CLIENT_EMAIL && !!process.env.GOOGLE_SHEETS_PRIVATE_KEY;

export async function fetchSheetCsv(spreadsheetId: string, gid?: string | null): Promise<string> {
  const url = sheetCsvUrl(spreadsheetId, gid);
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  const text = await res.text();
  if (!res.ok || text.trim().startsWith("<")) {
    throw new Error(
      "Could not read the sheet. Share it as 'Anyone with the link can view' (or Publish to web). Private-sheet (service account) support is a documented TODO.",
    );
  }
  return text;
}
