import { getQuestions, addQuestion, addImportJob } from "./dataProvider";
import { questionHash, type ParsedQuestion } from "./quizParse";
import { sanitizeHtml } from "./sanitizeHtml";
import type { ImportJobType, Question } from "./types";

export interface PreviewRow extends ParsedQuestion { duplicate: boolean; hash: string }

export async function previewParsed(parsed: ParsedQuestion[]): Promise<{ rows: PreviewRow[]; summary: { total: number; valid: number; invalid: number; duplicates: number } }> {
  const existing = await getQuestions();
  const existingHashes = new Set(existing.map((q) => q.duplicate_check_hash).filter(Boolean));
  const rows: PreviewRow[] = parsed.map((p) => {
    const hash = questionHash(p.question_html);
    return { ...p, hash, duplicate: existingHashes.has(hash) };
  });
  return {
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((r) => r.valid && !r.duplicate).length,
      invalid: rows.filter((r) => !r.valid).length,
      duplicates: rows.filter((r) => r.duplicate).length,
    },
  };
}

export async function importParsed(
  parsed: ParsedQuestion[],
  opts: { publish?: boolean; approve?: boolean; skipDuplicates?: boolean; type: ImportJobType; sourceConfig?: Record<string, unknown> },
): Promise<{ imported: number; errors: { row: number; message: string }[]; total: number }> {
  const existing = await getQuestions();
  const seen = new Set(existing.map((q) => q.duplicate_check_hash).filter(Boolean));
  const skipDuplicates = opts.skipDuplicates !== false;
  let imported = 0;
  const errors: { row: number; message: string }[] = [];

  for (const r of parsed) {
    if (!r.valid) { errors.push({ row: r.index, message: r.error || "Invalid row" }); continue; }
    const hash = questionHash(r.question_html);
    if (skipDuplicates && seen.has(hash)) { errors.push({ row: r.index, message: "Duplicate — skipped" }); continue; }
    const input: Partial<Question> = {
      question_html: sanitizeHtml(r.question_html),
      options: {
        A: sanitizeHtml(r.options.A), B: sanitizeHtml(r.options.B),
        C: sanitizeHtml(r.options.C), D: sanitizeHtml(r.options.D),
        E: r.options.E ? sanitizeHtml(r.options.E) : null,
      },
      correct_option: r.correct_option,
      explanation_html: r.explanation_html ? sanitizeHtml(r.explanation_html) : null,
      subject: r.subject, topic: r.topic, difficulty: r.difficulty, tags: r.tags,
      status: opts.publish ? "published" : "draft",
      quality_status: opts.approve ? "approved" : "unreviewed",
      duplicate_check_hash: hash,
    };
    try {
      await addQuestion(input);
      seen.add(hash);
      imported++;
    } catch (e) {
      errors.push({ row: r.index, message: e instanceof Error ? e.message : "Insert failed" });
    }
  }

  await addImportJob({
    type: opts.type,
    status: "completed",
    total_rows: parsed.length,
    success_count: imported,
    error_count: errors.length,
    errors,
    source_config: opts.sourceConfig || {},
  });

  return { imported, errors, total: parsed.length };
}
