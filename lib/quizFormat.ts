/**
 * Display-only formatting for UPSC statement-style question stems.
 * Does NOT modify stored content — only adds visual grouping at render time so
 * the intro line, the numbered-statement block, and the final question line read
 * as three clean groups.
 *
 * - Structured HTML (TipTap <ol>/<p>): returned unchanged; CSS (.quiz-rich)
 *   handles the spacing via list margins.
 * - Plain text with newlines: the contiguous numbered block ("1." "2." …) is
 *   wrapped in <div class="q-stmts"> so margins create exactly two gaps
 *   (before the first statement and after the last), keeping statements tight.
 */
export function formatQuestionHtml(raw: string | null | undefined): string {
  const html = raw || "";
  if (!html) return "";

  // Already structured markup — leave it to CSS.
  if (/<(ol|ul|li|p|div)\b/i.test(html)) return html;

  const lines = html.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const isStmt = (l: string) => /^\d+[.)]\s+/.test(l);
  const stmtIdx = lines.reduce<number[]>((acc, l, i) => (isStmt(l) ? [...acc, i] : acc), []);

  // Not a statement-style question — render exactly as before.
  if (stmtIdx.length < 2) return html;

  const first = stmtIdx[0];
  const last = stmtIdx[stmtIdx.length - 1];
  const intro = lines.slice(0, first);
  const statements = lines.slice(first, last + 1);
  const tail = lines.slice(last + 1);

  const parts: string[] = [];
  if (intro.length) parts.push(intro.join("<br>"));
  parts.push(`<div class="q-stmts">${statements.join("<br>")}</div>`);
  if (tail.length) parts.push(tail.join("<br>"));
  return parts.join("");
}
