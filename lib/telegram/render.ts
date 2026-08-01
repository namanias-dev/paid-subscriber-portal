import type { TelegramTemplateVars } from "./types";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export const SAMPLE_VARS: Required<
  Pick<TelegramTemplateVars, "name" | "course" | "amount" | "coupon" | "webinar_date">
> = {
  name: "Priya",
  course: "UPSC Foundation",
  amount: "4999",
  coupon: "NAMAN10",
  webinar_date: "15 Aug 2026",
};

export function extractVars(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(template || ""))) {
    const key = m[1]!;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

export function renderTelegramBody(
  template: string,
  vars: TelegramTemplateVars | Record<string, string | number | null | undefined> = {},
): string {
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  return (template || "").replace(re, (_full, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return "";
    return String(v);
  });
}
