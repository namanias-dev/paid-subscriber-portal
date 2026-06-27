/**
 * DLT Approval Sheet generation — the document staff submit to the operator/DLT
 * portal to get each template registered. Used by /docs/sms-dlt-templates.md and
 * the in-portal "Export DLT Approval Sheet" (Markdown + CSV).
 */
import { SEED_TEMPLATES, variableSlots, worstCaseFill, BRAND_LINE, MAX_RECOMMENDED_CHARS } from "./templates";
import { loginUrlSample, SMS_DEFAULT_SENDER_ID, SMS_DEFAULT_ROUTE } from "./config";

const ENTITY = "Naman Sharma IAS Academy";

export interface DltRow {
  id: string;
  name: string;
  useCase: string;
  category: string; // service | promotional
  /** DLT body with {#var#} placeholders in order. */
  dltBody: string;
  /** Ordered slot -> variable mapping. */
  mapping: { slot: number; variable: string }[];
  worstCaseChars: number;
  segments: number;
  over155: boolean;
}

/** Convert a portal body ({var}) into DLT body ({#var#}) preserving order. */
export function toDltBody(body: string): { dltBody: string; mapping: { slot: number; variable: string }[] } {
  const mapping: { slot: number; variable: string }[] = [];
  let slot = 0;
  const dltBody = body.replace(/\{([a-z_]+)\}/g, (_full, key: string) => {
    slot += 1;
    mapping.push({ slot, variable: key });
    return "{#var#}";
  });
  return { dltBody, mapping };
}

export function buildDltRows(): DltRow[] {
  const sample = loginUrlSample();
  return SEED_TEMPLATES.map((t) => {
    const { dltBody, mapping } = toDltBody(t.body);
    const { analysis } = worstCaseFill(t.body, sample);
    // mapping order must match the raw slot order
    const slots = variableSlots(t.body);
    const orderedMapping = slots.map((variable, i) => ({ slot: i + 1, variable }));
    return {
      id: t.id,
      name: t.name,
      useCase: t.use_case,
      category: t.message_type,
      dltBody,
      mapping: orderedMapping.length ? orderedMapping : mapping,
      worstCaseChars: analysis.length,
      segments: analysis.segments,
      over155: analysis.length > MAX_RECOMMENDED_CHARS,
    };
  });
}

export function dltToCsv(rows: DltRow[]): string {
  const head = ["Template Name", "Use Case", "Category", "Entity", "Sender ID", "Route", "DLT Body", "Variable Mapping", "DLT Template ID", "Worst-case Chars", "Segments"];
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.name, r.useCase, r.category, ENTITY, SMS_DEFAULT_SENDER_ID, SMS_DEFAULT_ROUTE,
      r.dltBody,
      r.mapping.map((m) => `${m.slot}=${m.variable}`).join("; "),
      "", // blank DLT Template ID column for staff to fill
      String(r.worstCaseChars), String(r.segments),
    ].map(esc).join(",")
  );
  return [head.join(","), ...lines].join("\n");
}

export function dltToMarkdown(rows: DltRow[]): string {
  const out: string[] = [];
  out.push("# SMS DLT Approval Sheet — Naman Sharma IAS Academy");
  out.push("");
  out.push(`- **Principal Entity:** ${ENTITY}`);
  out.push(`- **Sender ID (Header):** ${SMS_DEFAULT_SENDER_ID}`);
  out.push(`- **Route:** ${SMS_DEFAULT_ROUTE}`);
  out.push(`- **Brand line (every template):** "${BRAND_LINE}"`);
  out.push(`- **Charset:** GSM-7 only · "Rs" not "₹" · no emoji · target < ${MAX_RECOMMENDED_CHARS} chars worst-case`);
  out.push("");
  out.push("> Paste each registered **DLT Template ID** into the portal (Templates tab) before a template can go Active. Portal bodies byte-match the bodies below.");
  out.push("");
  for (const r of rows) {
    out.push(`## ${r.name}  \`${r.id}\``);
    out.push("");
    out.push(`- **Use case:** ${r.useCase} · **Category:** ${r.category}`);
    out.push(`- **Worst-case length:** ${r.worstCaseChars} chars · **${r.segments} segment(s)**${r.over155 ? "  ⚠️ exceeds " + MAX_RECOMMENDED_CHARS : ""}`);
    out.push(`- **DLT Template ID:** \`________________________\``);
    out.push("");
    out.push("**DLT body:**");
    out.push("");
    out.push("```");
    out.push(r.dltBody);
    out.push("```");
    out.push("");
    out.push("**Variable mapping (in order):**");
    out.push("");
    out.push("| Slot | Variable |");
    out.push("|---|---|");
    for (const m of r.mapping) out.push(`| {#var#} #${m.slot} | \`${m.variable}\` |`);
    if (!r.mapping.length) out.push("| — | (no variables) |");
    out.push("");
  }
  return out.join("\n");
}
