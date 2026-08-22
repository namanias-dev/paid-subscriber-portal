import { NextResponse } from "next/server";
import { getQuestions } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, private",
  Pragma: "no-cache",
  Expires: "0",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export async function GET(req: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!(await requirePermission("content_quizzes"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const questions = await getQuestions();
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const headers = [
      "id",
      "question_text",
      "option_a",
      "option_b",
      "option_c",
      "option_d",
      "option_e",
      "correct_option",
      "short_explanation",
      "subject",
      "topic",
      "difficulty",
      "tags",
      "status",
    ];
    const lines = [headers.join(",")];
    for (const q of questions) {
      const opts = (q.options || {}) as unknown as Record<string, string | null>;
      lines.push(
        [
          q.id,
          stripHtml(q.question_html),
          stripHtml(opts.A || ""),
          stripHtml(opts.B || ""),
          stripHtml(opts.C || ""),
          stripHtml(opts.D || ""),
          stripHtml(opts.E || ""),
          q.correct_option || "",
          stripHtml(q.short_explanation || ""),
          q.subject || "",
          q.topic || "",
          q.difficulty || "",
          (q.tags || []).join("|"),
          q.status || "",
        ]
          .map((c) => csvEscape(String(c)))
          .join(","),
      );
    }
    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="question-bank-live-${stamp}.csv"`,
      },
    });
  }

  return NextResponse.json(
    {
      ok: true,
      source: "live_question_bank",
      not_quiz_snapshots: true,
      exported_at: new Date().toISOString(),
      count: questions.length,
      questions,
    },
    {
      headers: {
        ...NO_STORE,
        "Content-Disposition": `attachment; filename="question-bank-live-${stamp}.json"`,
      },
    },
  );
}
