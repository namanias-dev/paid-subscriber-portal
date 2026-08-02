import { SITE_URL } from "../config";
import type { TelegramButton } from "./types";

export const DEFAULT_WELCOME =
  "Welcome to Naman Sharma IAS Academy, {{first_name}}!\n\nBrowse courses, join upcoming webinars, or talk to us — we are here to help.";

export const DEFAULT_FIRST_INBOUND_ACK =
  "Thanks for reaching out — our team will reply shortly.";

export const DEFAULT_UNKNOWN_COMMAND =
  "Sorry, I did not understand that. Tap /start to see options, or send a message and our team will reply.";

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
