/**
 * Meta Marketing API — read-only ad SPEND by campaign, used to compute
 * cost-per-conversion and ROAS in the admin attribution dashboard.
 *
 * COMPLETELY OPTIONAL and INERT: returns { configured: false } unless BOTH
 * META_AD_ACCOUNT_ID (act_XXXXXXXX) and a token (CAPI token reused, or a
 * dedicated ads-read token) are present. Attribution (leads/revenue) works
 * fully without this — only spend/CPA/ROAS need it. Never throws.
 */
import { META_GRAPH_VERSION } from "./metaEvents";

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== "" ? v : undefined;
}

export interface MetaSpend {
  configured: boolean;
  /** campaign name (lowercased) -> spend in the account currency (assumed INR). */
  byCampaign: Map<string, number>;
  totalSpend: number | null;
  error?: string;
}

const EMPTY: MetaSpend = { configured: false, byCampaign: new Map(), totalSpend: null };

/** YYYY-MM-DD in UTC (Meta insights time_range expects dates). */
function ymd(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export async function getMetaSpend(fromISO: string, toISO: string): Promise<MetaSpend> {
  const account = env("META_AD_ACCOUNT_ID");
  const token = env("META_ADS_ACCESS_TOKEN") || env("META_CAPI_ACCESS_TOKEN");
  if (!account || !token) return EMPTY;
  const version = env("META_GRAPH_VERSION") || META_GRAPH_VERSION;
  const acct = account.startsWith("act_") ? account : `act_${account}`;
  try {
    const timeRange = encodeURIComponent(JSON.stringify({ since: ymd(fromISO), until: ymd(toISO) }));
    const url =
      `https://graph.facebook.com/${version}/${acct}/insights` +
      `?level=campaign&fields=campaign_name,spend&time_range=${timeRange}&limit=500&access_token=${token}`;
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json()) as { data?: { campaign_name?: string; spend?: string }[]; error?: { message?: string } };
    if (json.error) return { ...EMPTY, configured: true, error: json.error.message || "Meta insights error" };
    const byCampaign = new Map<string, number>();
    let total = 0;
    for (const row of json.data || []) {
      const name = (row.campaign_name || "").toLowerCase();
      const spend = Number(row.spend || 0);
      if (!name || !Number.isFinite(spend)) continue;
      byCampaign.set(name, (byCampaign.get(name) || 0) + spend);
      total += spend;
    }
    return { configured: true, byCampaign, totalSpend: total };
  } catch {
    return { ...EMPTY, configured: true, error: "Meta insights fetch failed" };
  }
}
