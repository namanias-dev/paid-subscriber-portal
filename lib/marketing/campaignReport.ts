/**
 * Campaign Performance aggregation (PURE, first-party counts).
 *
 * Groups CRM leads by utm_campaign and by channel and joins the downstream
 * conversion flags already maintained on each lead (webinar_registered, admitted)
 * to produce a leads → webinar registrations → sign-ups funnel per campaign, with
 * both counts AND rates so campaigns can be compared on quality, not just volume.
 *
 * Read-only + side-effect free. No cost/CPC/spend (that needs the Google Ads API
 * — see lib/marketing/googleAdsStub.ts). Nothing here sends or executes.
 */
import type { Lead } from "@/lib/types";

export interface CampaignRow {
  /** Grouping key value ("(no campaign)" / "(no channel)" when absent). */
  key: string;
  /** utm_campaign for a campaign row; the channel string for a channel row. */
  label: string;
  /** Dominant channel for a campaign row (blank for channel rows). */
  channel: string;
  leads: number;
  webinarRegs: number;
  signups: number;
  /** webinarRegs / leads, 0..1 (null when leads = 0). */
  webinarRate: number | null;
  /** signups / leads, 0..1 (null when leads = 0). */
  signupRate: number | null;
}

export interface CampaignReport {
  byCampaign: CampaignRow[];
  byChannel: CampaignRow[];
  totals: Omit<CampaignRow, "key" | "label" | "channel">;
}

const NO_CAMPAIGN = "(no campaign)";
const NO_CHANNEL = "(no channel)";

function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null;
}

interface Acc {
  leads: number;
  webinarRegs: number;
  signups: number;
  channels: Map<string, number>;
}

function emptyAcc(): Acc {
  return { leads: 0, webinarRegs: 0, signups: 0, channels: new Map() };
}

function bump(acc: Acc, l: Lead): void {
  acc.leads += 1;
  if (l.webinar_registered) acc.webinarRegs += 1;
  if (l.admitted) acc.signups += 1;
  const ch = (l.channel || "").trim() || NO_CHANNEL;
  acc.channels.set(ch, (acc.channels.get(ch) || 0) + 1);
}

function dominantChannel(acc: Acc): string {
  let best = "";
  let bestN = -1;
  for (const [ch, n] of acc.channels) if (n > bestN) { best = ch; bestN = n; }
  return best;
}

function toRow(key: string, label: string, channel: string, acc: Acc): CampaignRow {
  return {
    key,
    label,
    channel,
    leads: acc.leads,
    webinarRegs: acc.webinarRegs,
    signups: acc.signups,
    webinarRate: rate(acc.webinarRegs, acc.leads),
    signupRate: rate(acc.signups, acc.leads),
  };
}

/**
 * Aggregate an already range-filtered set of (non-merged) leads into a campaign
 * report. Rows are sorted by leads captured (desc). Callers filter by created_at
 * before passing leads in.
 */
export function aggregateLeadCampaigns(leads: Lead[]): CampaignReport {
  const byCampaign = new Map<string, Acc>();
  const byChannel = new Map<string, Acc>();
  const totals = emptyAcc();

  for (const l of leads) {
    if (l.merged_into) continue;
    const campKey = (l.utm_campaign || "").trim() || NO_CAMPAIGN;
    const chKey = (l.channel || "").trim() || NO_CHANNEL;
    const c = byCampaign.get(campKey) || emptyAcc();
    bump(c, l);
    byCampaign.set(campKey, c);
    const ch = byChannel.get(chKey) || emptyAcc();
    bump(ch, l);
    byChannel.set(chKey, ch);
    bump(totals, l);
  }

  const campaignRows = [...byCampaign.entries()]
    .map(([k, acc]) => toRow(k, k, dominantChannel(acc), acc))
    .sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));
  const channelRows = [...byChannel.entries()]
    .map(([k, acc]) => toRow(k, k, "", acc))
    .sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));

  return {
    byCampaign: campaignRows,
    byChannel: channelRows,
    totals: {
      leads: totals.leads,
      webinarRegs: totals.webinarRegs,
      signups: totals.signups,
      webinarRate: rate(totals.webinarRegs, totals.leads),
      signupRate: rate(totals.signups, totals.leads),
    },
  };
}
