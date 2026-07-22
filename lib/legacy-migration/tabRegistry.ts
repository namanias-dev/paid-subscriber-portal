/**
 * The 9 included legacy tabs from the "UPSC WORKSHOP LEADS-MARKETING" workbook,
 * with:
 *   - the column-header mapping used by the transformer,
 *   - the cross-tab dedupe priority (lower = wins on collision),
 *   - the proposed channel bucket + platform hint used to stamp `channel_legacy`
 *     and `attribution.legacy_*` fields.
 *
 * The priority table below is a portable mirror of matcher.py:116–126
 * `LEAD_SOURCE_PRIORITY` in the legacy target folder — the source of truth for
 * cross-tab priority. Change here iff we change there.
 *
 * Nothing in this file talks to the network or Google Sheets.
 */

export const INCLUDED_TABS = [
  "FB LEADS",
  "Copy of FB LEADS",
  "BACKUP_ALL_LEADS",
  "Call These Leads",
  "Google Ad Campaign",
  "Sheet1",
  "WhatsApp",
  "Instagram: NEW Batch",
  "Google Ads",
] as const;

export type LegacyTab = (typeof INCLUDED_TABS)[number];

export const EXCLUDED_TABS = ["Sheet13", "DO NOT TOUCH", "Google Ads Leads", "OLD LEADS"] as const;

/**
 * Cross-tab dedupe priority. When the same canonical phone appears in ≥2 tabs,
 * we keep the row from the tab with the LOWEST number and stack the losers into
 * `attribution.legacy_touches[]`. `FB LEADS`=1 is the primary Meta Lead Ads
 * export and always wins over the older `BACKUP_ALL_LEADS` snapshot.
 */
export const LEAD_SOURCE_PRIORITY: Record<LegacyTab, number> = {
  "FB LEADS": 1,
  "Copy of FB LEADS": 2,
  "BACKUP_ALL_LEADS": 3,
  "Call These Leads": 4,
  "Google Ad Campaign": 5,
  "Sheet1": 6,
  "WhatsApp": 7,
  "Instagram: NEW Batch": 8,
  "Google Ads": 9,
};

/**
 * Per-tab column mapping — first column name (case-sensitive) that resolves is
 * used. All are `readonly string[]` because the transformer only reads them.
 * `campaign_fallback` supplies the literal string used when no campaign column
 * resolves; `null` means "leave utm_campaign NULL and record raw only".
 */
export interface LegacyTabSpec {
  readonly tab: LegacyTab;
  readonly timestampColumns: readonly string[];
  readonly phoneColumns: readonly string[];
  readonly emailColumns: readonly string[];
  readonly nameColumns: readonly string[];
  readonly campaignColumns: readonly string[];
  readonly stateColumns: readonly string[];
  readonly statusColumns: readonly string[];
  readonly sourceColumns: readonly string[];
  /** Literal string stamped on `channel_legacy`. Non-null for every tab. */
  readonly channelLegacy: string;
  /** Hint stamped on `attribution.platform_hint`. */
  readonly platformHint: string | null;
  /** Non-null means "walk every cell of the row and find the first Indian phone"
   *  fallback (used by the schema-less `Google Ads` tab). */
  readonly usePhoneAnyCellFallback: boolean;
  /** When true, force `utm_campaign` to NULL and store raw campaign as legacy-only. */
  readonly campaignFallbackOnly: boolean;
  /** When true, the tab has no timestamp column at all — `first_seen_at` stays NULL and
   *  created_at is set to the import_batch timestamp. */
  readonly noSourceTimestamp: boolean;
  /** True when this tab needs the smart B/C resolver (only FB LEADS today). */
  readonly smartBCResolver: boolean;
}

const NO_COLS: readonly string[] = [];

export const TAB_SPECS: Record<LegacyTab, LegacyTabSpec> = {
  "FB LEADS": {
    tab: "FB LEADS",
    timestampColumns: ["Date"],
    phoneColumns: ["phone_number"],
    emailColumns: ["email"],
    nameColumns: ["full_name"],
    campaignColumns: ["form_name", "Form"],
    stateColumns: ["State", "Admission Funnel"],
    statusColumns: ["Status"],
    sourceColumns: ["platform"],
    channelLegacy: "Meta Ads (legacy)",
    platformHint: "fb",
    usePhoneAnyCellFallback: false,
    campaignFallbackOnly: false,
    noSourceTimestamp: false,
    smartBCResolver: true,
  },
  "Copy of FB LEADS": {
    tab: "Copy of FB LEADS",
    timestampColumns: ["Date"],
    phoneColumns: ["phone_number", "Ph"],
    emailColumns: ["email"],
    nameColumns: ["full_name"],
    campaignColumns: ["campaign_name", "form_name", "form_id"],
    stateColumns: ["State"],
    statusColumns: ["Call Response"],
    sourceColumns: ["platform"],
    channelLegacy: "Meta Ads (legacy)",
    platformHint: "fb",
    usePhoneAnyCellFallback: false,
    campaignFallbackOnly: false,
    noSourceTimestamp: false,
    smartBCResolver: false,
  },
  "BACKUP_ALL_LEADS": {
    tab: "BACKUP_ALL_LEADS",
    timestampColumns: ["created_time"],
    phoneColumns: ["phone_number", "Phone No."],
    emailColumns: ["email"],
    nameColumns: ["full_name"],
    campaignColumns: ["campaign_name", "form_name", "form_id"],
    stateColumns: NO_COLS,
    statusColumns: ["Call Response"],
    sourceColumns: ["platform"],
    channelLegacy: "Meta Ads (legacy, snapshot)",
    platformHint: "fb",
    usePhoneAnyCellFallback: false,
    campaignFallbackOnly: false,
    noSourceTimestamp: false,
    smartBCResolver: false,
  },
  "Call These Leads": {
    tab: "Call These Leads",
    timestampColumns: ["created_time"],
    phoneColumns: ["Phone Number"],
    emailColumns: NO_COLS,
    nameColumns: ["full_name"],
    campaignColumns: ["form_name", "campaign_name"],
    stateColumns: NO_COLS,
    statusColumns: ["Response"],
    sourceColumns: NO_COLS,
    channelLegacy: "Unknown (legacy, manual list)",
    platformHint: null,
    usePhoneAnyCellFallback: false,
    campaignFallbackOnly: false,
    noSourceTimestamp: false,
    smartBCResolver: false,
  },
  "Google Ad Campaign": {
    tab: "Google Ad Campaign",
    timestampColumns: ["Date"],
    phoneColumns: ["Contact"],
    emailColumns: NO_COLS,
    nameColumns: ["Name"],
    campaignColumns: ["Campaign"],
    stateColumns: ["Location"],
    statusColumns: ["Call Status", "Remarks"],
    sourceColumns: NO_COLS,
    channelLegacy: "Google Ads (legacy)",
    platformHint: "google",
    usePhoneAnyCellFallback: false,
    campaignFallbackOnly: false,
    noSourceTimestamp: false,
    smartBCResolver: false,
  },
  "Sheet1": {
    tab: "Sheet1",
    timestampColumns: ["Date"],
    phoneColumns: ["Phone number (10 digits only)", "Phone No."],
    emailColumns: ["Email (Make sure it is CORRECT)"],
    nameColumns: ["Name"],
    campaignColumns: NO_COLS,
    stateColumns: NO_COLS,
    statusColumns: ["status", "comment", "remarks"],
    sourceColumns: NO_COLS,
    channelLegacy: "Organic (legacy, form)",
    platformHint: null,
    usePhoneAnyCellFallback: false,
    campaignFallbackOnly: true,
    noSourceTimestamp: false,
    smartBCResolver: false,
  },
  "WhatsApp": {
    tab: "WhatsApp",
    timestampColumns: ["WhatsApp Date"],
    phoneColumns: ["Phone No."],
    emailColumns: NO_COLS,
    nameColumns: ["Full Name"],
    campaignColumns: NO_COLS,
    stateColumns: ["State"],
    statusColumns: ["Student Status"],
    sourceColumns: NO_COLS,
    channelLegacy: "Organic (legacy, WhatsApp/Owned)",
    platformHint: "whatsapp",
    usePhoneAnyCellFallback: false,
    campaignFallbackOnly: true,
    noSourceTimestamp: false,
    smartBCResolver: false,
  },
  "Instagram: NEW Batch": {
    tab: "Instagram: NEW Batch",
    timestampColumns: ["Timestamp"],
    phoneColumns: ["Phone number"],
    emailColumns: NO_COLS,
    nameColumns: ["Name"],
    campaignColumns: NO_COLS,
    stateColumns: ["Current State"],
    statusColumns: NO_COLS,
    sourceColumns: NO_COLS,
    // Per user-approved Q2: keep origin unconfirmed and flag for review.
    channelLegacy: "Meta Ads (legacy, IG origin unconfirmed)",
    platformHint: "instagram",
    usePhoneAnyCellFallback: false,
    campaignFallbackOnly: true,
    noSourceTimestamp: false,
    smartBCResolver: false,
  },
  "Google Ads": {
    tab: "Google Ads",
    timestampColumns: NO_COLS,
    phoneColumns: NO_COLS,
    emailColumns: NO_COLS,
    nameColumns: NO_COLS,
    campaignColumns: NO_COLS,
    stateColumns: NO_COLS,
    statusColumns: NO_COLS,
    sourceColumns: NO_COLS,
    channelLegacy: "Google Ads (legacy, low-conf)",
    platformHint: "google",
    usePhoneAnyCellFallback: true,
    campaignFallbackOnly: true,
    noSourceTimestamp: true,
    smartBCResolver: false,
  },
};

/** The exact spreadsheet ID for the legacy workbook — reused by importer + sync route. */
export const LEGACY_WORKBOOK_SPREADSHEET_ID = "1tyM1bjzM842259xj0e8A-hrYc-xKSXWdOwgxFkzuaA0";

/** Human-facing name of the workbook (also used in logs / reports). */
export const LEGACY_WORKBOOK_NAME = "UPSC WORKSHOP LEADS-MARKETING";
