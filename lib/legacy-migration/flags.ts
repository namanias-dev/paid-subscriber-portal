/**
 * Feature flags for the legacy-lead migration shipment. All three DEFAULT OFF —
 * the deployed code is a no-op in production until an operator flips them in
 * Vercel. Kept server-only (checked in Node/API code, never bundled in the
 * client) and read on every call so a runtime env flip takes effect instantly
 * without a redeploy.
 *
 * - `LEGACY_IMPORT_ENABLED`  — gates the one-time backfill importer's --commit
 *                              mode. --dry-run runs regardless (never writes).
 * - `SHEETS_SYNC_ENABLED`    — gates the /api/cron/legacy-sheets-sync route.
 *                              Route returns 501 (Not Implemented) when off.
 * - `META_LEADS_ENABLED`     — gates the Meta Lead Ads webhook + Graph fetch.
 *                              Webhook verify handshake still short-circuits
 *                              to 501 with a diagnostic body when off.
 *
 * Every boolean is exact-string `"true"` (case-insensitive). Any other value —
 * including `"1"`, `"yes"`, or a typo — is treated as false so a misconfigured
 * env never accidentally activates a shipment.
 */

function readFlag(name: string): boolean {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim().toLowerCase() === "true";
}

export function isLegacyImportEnabled(): boolean {
  return readFlag("LEGACY_IMPORT_ENABLED");
}

export function isSheetsSyncEnabled(): boolean {
  return readFlag("SHEETS_SYNC_ENABLED");
}

export function isMetaLeadsEnabled(): boolean {
  return readFlag("META_LEADS_ENABLED");
}

/** Snapshot of all three flags — useful for the flag-off no-op regression test. */
export function legacyMigrationFlagSnapshot(): {
  legacyImport: boolean;
  sheetsSync: boolean;
  metaLeads: boolean;
} {
  return {
    legacyImport: isLegacyImportEnabled(),
    sheetsSync: isSheetsSyncEnabled(),
    metaLeads: isMetaLeadsEnabled(),
  };
}
