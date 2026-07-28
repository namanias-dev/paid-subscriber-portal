"use client";

import { useEffect, useState } from "react";

interface ResultData {
  quiz: { title: string; subject: string | null };
  attempt: {
    score: number; max_score: number; correct_count: number; incorrect_count: number;
    unattempted_count: number; accuracy: number; negative_marks: number;
    time_taken_seconds: number | null; percentile: number | null; rank: number | null;
    submitted_at: string | null; student_name: string | null;
  };
  topic_breakdown: { label: string; subject: string | null; correct: number; incorrect: number; total: number }[];
  questions: {
    order: number; question_html: string; options: { key: string; html: string }[];
    your_option: string | null; correct_option: string | null; is_correct: boolean;
    is_unattempted: boolean; explanation_html: string | null;
    marks_awarded: number; negative_marks_deducted: number;
  }[];
  disclaimer: string;
}

// Subtle, repeating diagonal watermark (CSS-only so it survives "Save as PDF").
const WATERMARK =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='240'><text x='20' y='140' fill='%231e3a8a' fill-opacity='0.08' font-size='21' font-family='Arial, sans-serif' font-weight='700' transform='rotate(-30 180 120)'>NAMAN SHARMA IAS ACADEMY</text></svg>\")";

const preLine: React.CSSProperties = { whiteSpace: "pre-line", lineHeight: 1.65, wordBreak: "break-word" };

export default function ResultPrint({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/public/quiz/result?attemptId=${attemptId}`)
      .then((r) => r.json())
      .then((d) => setData(d.ok ? d.result : null))
      .finally(() => setLoading(false));
  }, [attemptId]);

  // Open the print dialog only once the report is actually paintable: web fonts
  // resolved, images decoded, and a frame rendered. Printing earlier can capture
  // a half-laid-out page. Bounded so a slow asset can never strand the user.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;

    const assetsSettled = Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      ...Array.from(document.images)
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            })
        ),
    ]);

    Promise.race([assetsSettled, new Promise((resolve) => setTimeout(resolve, 3000))])
      .then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      .then(() => { if (!cancelled) window.print(); });

    return () => { cancelled = true; };
  }, [data]);

  if (loading) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Preparing report…</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Result not found or access denied.</div>;

  const { attempt, quiz } = data;
  const pct = attempt.max_score ? Math.round((attempt.score / attempt.max_score) * 100) : 0;

  return (
    <div className="quiz-print-root" style={{ position: "relative", maxWidth: 820, margin: "0 auto", padding: 28, fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      {/* This <style> is mounted only by this route, so none of it can reach
          another page's print output. */}
      <style>{`
        @page { size: A4 portrait; margin: 14mm; }

        /* Render statement formatting correctly: keep ordered/unordered list
           markers visible (overriding the global list-style reset) AND preserve
           literal numbered lines for plain-text questions. */
        .pdf-rich { white-space: pre-line; line-height: 1.65; word-break: break-word; }
        .pdf-rich p { margin: 0.4em 0; white-space: pre-line; }
        .pdf-rich ol { list-style: decimal outside; padding-left: 1.6em; margin: 0.4em 0; white-space: normal; }
        .pdf-rich ul { list-style: disc outside; padding-left: 1.6em; margin: 0.4em 0; white-space: normal; }
        .pdf-rich li { margin: 0.2em 0; }
        .pdf-rich img { max-width: 100%; height: auto; }

        @media print {
          /* Paper is always light, whatever the device or OS prefers, so dark
             surfaces can never come out as black blocks. */
          html, body {
            background-color: #fff !important;
            color: #0f172a !important;
            color-scheme: light !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

          .no-print { display: none !important; }

          /* @page owns the margins now; the on-screen padding would double them. */
          .quiz-print-root { max-width: none !important; margin: 0 !important; padding: 0 !important; }

          /* A single absolutely-positioned overlay only paints on page one, so
             let the page box carry the watermark instead — it then tiles across
             every sheet. */
          .quiz-print-watermark { display: none !important; }
          body {
            background-image: ${WATERMARK} !important;
            background-repeat: repeat !important;
          }

          .qp-question { break-inside: avoid; page-break-inside: avoid; }
          .qp-explanation { break-inside: avoid; page-break-inside: avoid; }
          .qp-footer { break-inside: avoid; page-break-inside: avoid; }
          h1, h2 { break-after: avoid; page-break-after: avoid; }
          table { break-inside: auto; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {/* Watermark layer — behind content (screen only; print uses the page box) */}
      <div className="quiz-print-watermark" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, pointerEvents: "none", backgroundImage: WATERMARK, backgroundRepeat: "repeat" }} aria-hidden />

      <div style={{ position: "relative", zIndex: 1 }}>
        <div className="no-print" style={{ marginBottom: 16, textAlign: "right" }}>
          <button onClick={() => window.print()} style={{ padding: "8px 16px", background: "#1e3a8a", color: "#fff", border: 0, borderRadius: 8, cursor: "pointer" }}>Save as PDF / Print</button>
        </div>

        <div style={{ borderBottom: "3px solid #1e3a8a", paddingBottom: 12, marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 22, color: "#1e3a8a" }}>Naman Sharma IAS Academy</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>{quiz.title}{quiz.subject ? ` · ${quiz.subject}` : ""}</p>
        </div>

        <table style={{ width: "100%", fontSize: 13, marginBottom: 16 }}>
          <tbody>
            <tr><td style={{ padding: 3 }}><b>Student:</b> {attempt.student_name || "Guest"}</td><td style={{ padding: 3 }}><b>Date:</b> {attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString("en-IN") : "—"}</td></tr>
            <tr><td style={{ padding: 3 }}><b>Score:</b> {attempt.score} / {attempt.max_score} ({pct}%)</td><td style={{ padding: 3 }}><b>Accuracy:</b> {attempt.accuracy}%</td></tr>
            <tr><td style={{ padding: 3 }}><b>Correct / Incorrect / Skipped:</b> {attempt.correct_count} / {attempt.incorrect_count} / {attempt.unattempted_count}</td><td style={{ padding: 3 }}><b>Negative:</b> -{attempt.negative_marks}</td></tr>
            <tr><td style={{ padding: 3 }}><b>Time taken:</b> {attempt.time_taken_seconds != null ? `${Math.floor(attempt.time_taken_seconds / 60)}m ${attempt.time_taken_seconds % 60}s` : "—"}</td><td style={{ padding: 3 }}>{attempt.rank != null ? <><b>Rank:</b> #{attempt.rank}{attempt.percentile != null ? ` · ${attempt.percentile}%ile` : ""}</> : null}</td></tr>
          </tbody>
        </table>

        {data.topic_breakdown.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, color: "#1e3a8a" }}>Topic-wise performance</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 18 }}>
              <thead><tr style={{ background: "#f1f5f9" }}><th style={{ textAlign: "left", padding: 6, border: "1px solid #e2e8f0" }}>Topic</th><th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Correct</th><th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Total</th><th style={{ padding: 6, border: "1px solid #e2e8f0" }}>Accuracy</th></tr></thead>
              <tbody>
                {data.topic_breakdown.map((t) => {
                  const acc = t.correct + t.incorrect ? Math.round((t.correct / (t.correct + t.incorrect)) * 100) : 0;
                  return <tr key={t.label}><td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{t.label}</td><td style={{ textAlign: "center", padding: 6, border: "1px solid #e2e8f0" }}>{t.correct}</td><td style={{ textAlign: "center", padding: 6, border: "1px solid #e2e8f0" }}>{t.total}</td><td style={{ textAlign: "center", padding: 6, border: "1px solid #e2e8f0" }}>{acc}%</td></tr>;
                })}
              </tbody>
            </table>
          </>
        )}

        <h2 style={{ fontSize: 15, color: "#1e3a8a" }}>Question-wise review</h2>
        {data.questions.map((qq, i) => (
          <div key={i} className="qp-question" style={{ borderBottom: "1px solid #e2e8f0", padding: "10px 0", fontSize: 13, breakInside: "avoid" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <b>Q{qq.order}.</b>
              <span className="pdf-rich" style={{ flex: 1 }} dangerouslySetInnerHTML={{ __html: qq.question_html }} />
            </div>
            <div style={{ margin: "6px 0 0 18px" }}>
              {qq.options.map((o) => {
                const correct = o.key === qq.correct_option;
                const yours = o.key === qq.your_option;
                return <div key={o.key} style={{ ...preLine, color: correct ? "#15803d" : yours ? "#b91c1c" : "#334155", fontWeight: correct || yours ? 600 : 400 }}><span>{o.key}.</span> <span dangerouslySetInnerHTML={{ __html: o.html }} />{correct ? " ✓" : yours ? " (your answer)" : ""}</div>;
              })}
            </div>
            <p style={{ margin: "4px 0 0 18px", fontSize: 12, color: "#64748b" }}>
              {qq.is_unattempted ? "Skipped" : qq.is_correct ? `Correct (+${qq.marks_awarded})` : `Incorrect (-${qq.negative_marks_deducted})`}
            </p>
            {qq.explanation_html && (
              <div className="qp-explanation" style={{ margin: "4px 0 0 18px", fontSize: 12, background: "#f8fafc", padding: 8, borderRadius: 6 }}>
                <b>Explanation:</b> <span className="pdf-rich" dangerouslySetInnerHTML={{ __html: qq.explanation_html }} />
              </div>
            )}
          </div>
        ))}

        <div className="qp-footer" style={{ marginTop: 24, borderTop: "2px solid #1e3a8a", paddingTop: 12, textAlign: "center", fontSize: 13, lineHeight: 1.6 }}>
          <p style={{ margin: 0, fontWeight: 700, color: "#1e3a8a", letterSpacing: 0.3 }}>NAMAN SHARMA IAS ACADEMY</p>
          <p style={{ margin: "2px 0 0", color: "#334155" }}>Address: SCO 173-174, Sec-17C, Chandigarh</p>
          <p style={{ margin: "2px 0 0", color: "#334155" }}>Call/WhatsApp: +91-843-768-6541</p>
        </div>
      </div>
    </div>
  );
}
