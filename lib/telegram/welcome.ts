import { SITE_URL } from "../config";
import { inlineKeyboardFromButtons, sendMessage } from "./botApi";
import { getSettings } from "./subscribers";
import type { TelegramButton } from "./types";

const DEFAULT_WELCOME =
  "Welcome to Naman Sharma IAS Academy. Browse courses, join upcoming webinars, or talk to us — we are here to help.";

function siteBase(): string {
  return (SITE_URL || "https://www.namanias.com").replace(/\/$/, "");
}

export function defaultWelcomeButtons(): TelegramButton[] {
  const base = siteBase();
  return [
    { label: "Courses", url: `${base}/courses` },
    { label: "Upcoming webinar", url: `${base}/webinars` },
    { label: "Talk to us", url: `${base}/contact` },
  ];
}

/** Send welcome body + default (or configured) buttons. Never throws. */
export async function sendWelcome(chatId: string | number): Promise<void> {
  try {
    const settings = await getSettings();
    const body = (settings.welcome_body || DEFAULT_WELCOME).trim() || DEFAULT_WELCOME;
    const buttons =
      settings.welcome_buttons?.length > 0 ? settings.welcome_buttons : defaultWelcomeButtons();
    await sendMessage({
      chat_id: chatId,
      text: body,
      reply_markup: inlineKeyboardFromButtons(buttons),
      disable_web_page_preview: true,
    });
  } catch {
    /* welcome must never break /start handling */
  }
}
