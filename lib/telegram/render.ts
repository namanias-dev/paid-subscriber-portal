/** @deprecated Prefer lib/telegram/compose — kept for existing imports. */
export {
  extractVars,
  prepareOutboundHtml as renderTelegramBodyHtml,
  DEFAULT_FALLBACKS,
  TELEGRAM_VARS,
} from "./compose";
export { prepareOutboundHtml } from "./compose";

import { prepareOutboundHtml } from "./compose";

export const SAMPLE_VARS = {
  name: "Priya",
  first_name: "Priya",
  course: "UPSC Foundation",
  amount: "4999",
  coupon: "NAMAN10",
  webinar_date: "15 Aug 2026",
  course_link_1: "https://www.namanias.com/courses",
  course_link_2: "https://www.namanias.com/courses",
  webinar_link: "https://www.namanias.com/webinars",
};

/** Plain-ish render for welcome/legacy callers (strips tags after HTML prepare). */
export function renderTelegramBody(
  template: string,
  vars: Record<string, string | number | null | undefined> = {},
  fallbacks: Record<string, string> = {},
): string {
  return prepareOutboundHtml(template, vars, fallbacks).html.replace(/<[^>]+>/g, "");
}
