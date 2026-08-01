import { botUsername as envBotUsername } from "./config";
import { getSettings } from "./subscribers";

async function resolveUsername(): Promise<string | null> {
  try {
    const settings = await getSettings();
    if (settings.bot_username) return settings.bot_username.replace(/^@/, "");
  } catch {
    /* ignore */
  }
  return envBotUsername();
}

/** t.me deep link with start payload (alphanumeric + underscore). */
export async function botDeepLink(payload: string): Promise<string | null> {
  const username = await resolveUsername();
  if (!username) return null;
  const clean = (payload || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!clean) return `https://t.me/${username}`;
  return `https://t.me/${username}?start=${encodeURIComponent(clean)}`;
}

export async function inviteLinkForLead(leadId: string): Promise<string | null> {
  const id = (leadId || "").trim();
  if (!id) return null;
  return botDeepLink(`lead_${id}`);
}

export async function genericCampaignLink(campaign: string): Promise<string | null> {
  const c = (campaign || "").trim();
  if (!c) return null;
  return botDeepLink(c);
}
