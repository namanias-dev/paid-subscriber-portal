import { NextResponse } from "next/server";
import { getQuestions, addQuestion, addImportJob } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import { parseBulkQuestions, questionHash } from "@/lib/quizParse";
import { sanitizeHtml } from "@/lib/sanitizeHtml";
import type { Question } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_quizzes"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "preview");
    const text = String(body.text || "");

    const parsed = parseBulkQuestions(text);
    const existing = await getQuestions();
    const existingHashes = new Set(existing.map((q) => q.duplicate_check_hash).filter(Boolean));

    const rows = parsed.map((p) => {
      const hash = questionHash(p.question_html);
      return { ...p, duplicate: existingHashes.has(hash), hash };
    });

    if (action === "preview") {
      return NextResponse.json({
        ok: true,
        rows,
        summary: {
          total: rows.length,
          valid: rows.filter((r) => r.valid && !r.duplicate).length,
          invalid: rows.filter((r) => !r.valid).length,
          duplicates: rows.filter((r) => r.duplicate).length,
        },
      });
    }

    // action === "import": only import valid, non-duplicate rows.
    const skipDuplicates = body.skipDuplicates !== false;
    let success = 0;
    const errors: { row: number; message: string }[] = [];
    const seen = new Set(existingHashes);

    for (const r of rows) {
      if (!r.valid) {
        errors.push({ row: r.index, message: r.error || "Invalid row" });
        continue;
      }
      if (skipDuplicates && seen.has(r.hash)) {
        errors.push({ row: r.index, message: "Duplicate — skipped" });
        continue;
      }
      const input: Partial<Question> = {
        question_html: sanitizeHtml(r.question_html),
        options: {
          A: sanitizeHtml(r.options.A),
          B: sanitizeHtml(r.options.B),
          C: sanitizeHtml(r.options.C),
          D: sanitizeHtml(r.options.D),
          E: r.options.E ? sanitizeHtml(r.options.E) : null,
        },
        correct_option: r.correct_option,
        explanation_html: r.explanation_html ? sanitizeHtml(r.explanation_html) : null,
        subject: r.subject,
        topic: r.topic,
        difficulty: r.difficulty,
        tags: r.tags,
        status: body.publish ? "published" : "draft",
        quality_status: body.approve ? "approved" : "unreviewed",
        duplicate_check_hash: r.hash,
      };
      try {
        await addQuestion(input);
        seen.add(r.hash);
        success++;
      } catch (e) {
        errors.push({ row: r.index, message: e instanceof Error ? e.message : "Insert failed" });
      }
    }

    await addImportJob({
      type: "BULK_TEXT",
      status: "completed",
      total_rows: rows.length,
      success_count: success,
      error_count: errors.length,
      errors,
      source_config: { mode: "bulk_text" },
    });

    return NextResponse.json({ ok: true, imported: success, errors, total: rows.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
