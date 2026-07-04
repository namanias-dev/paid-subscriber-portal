import type { jsPDF } from "jspdf";
import type { OverallPerformance, MasteryRow } from "./overallPerformance";
import type { LeaderboardRow } from "./leaderboard";

/**
 * Client-side PDF exporters for the performance views, reusing the project's
 * existing `jspdf` dependency (no new lib). Every exporter is fed the SAME data
 * object already rendered on screen, so a PDF can never drift from the UI.
 *
 * Premium "report" styling (navy/gold), manual table layout with pagination —
 * mirrors lib/receiptPdf.ts conventions (₹ glyph avoided; standard fonts only).
 */

const NAVY: [number, number, number] = [10, 26, 63];
const GOLD: [number, number, number] = [184, 134, 11];
const INK: [number, number, number] = [26, 32, 44];
const GREY: [number, number, number] = [110, 116, 128];
const LINE: [number, number, number] = [223, 227, 234];
const GREEN: [number, number, number] = [10, 138, 58];
const AMBER: [number, number, number] = [180, 120, 8];
const RED: [number, number, number] = [200, 45, 45];

const MARGIN = 40;

function bandColor(band: MasteryRow["band"]): [number, number, number] {
  return band === "strong" ? GREEN : band === "moderate" ? AMBER : RED;
}

function accColor(acc: number): [number, number, number] {
  return acc >= 75 ? GREEN : acc >= 40 ? AMBER : RED;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function safeName(s: string): string {
  return (s || "student").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "student";
}

/** A cursor-based page helper shared by both exporters. */
async function makeDoc(orientation: "p" | "l") {
  const { jsPDF } = await import("jspdf"); // lazy: keep jspdf out of the initial bundle
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const state = { y: MARGIN, pageW, pageH };

  function ensure(h: number) {
    if (state.y + h > state.pageH - MARGIN) {
      doc.addPage();
      state.y = MARGIN;
    }
  }
  return { doc, state, ensure };
}

/* ----------------------------- PER-STUDENT REPORT ----------------------------- */
export async function downloadOverallPerformancePdf(data: OverallPerformance) {
  const { doc, state, ensure } = await makeDoc("p");
  const contentW = state.pageW - MARGIN * 2;

  // Header band.
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, state.pageW, 88, "F");
  doc.setTextColor(...GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("OVERALL PERFORMANCE REPORT", MARGIN, 30);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text(data.studentName || "Student", MARGIN, 54);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(210, 216, 230);
  const sub = [data.batchLabel, `Snapshot: ${fmtDate(data.snapshotISO)}`].filter(Boolean).join("   •   ");
  doc.text(sub, MARGIN, 72);
  state.y = 112;

  // Summary stat grid.
  const h = data.hero;
  const stats: [string, string, [number, number, number]?][] = [
    ["Overall accuracy", `${h.accuracy}%`, accColor(h.accuracy)],
    ["Quizzes attempted", String(h.totalQuizzes)],
    ["Questions faced", String(h.totalQuestions)],
    ["Attempt rate", `${h.attemptRate}%`],
    ["Correct", String(h.correct), GREEN],
    ["Incorrect", String(h.incorrect), RED],
    ["Skipped", String(h.skipped), GREY],
    ["Attempts", String(h.totalAttempts)],
  ];
  const cols = 4;
  const cellW = contentW / cols;
  const cellH = 46;
  stats.forEach((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * cellW;
    const y = state.y + row * cellH;
    doc.setDrawColor(...LINE);
    doc.roundedRect(x, y, cellW - 8, cellH - 8, 4, 4, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(s[0].toUpperCase(), x + 8, y + 15);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...(s[2] || INK));
    doc.text(s[1], x + 8, y + 33);
  });
  state.y += Math.ceil(stats.length / cols) * cellH + 8;

  // Section helper.
  const sectionTitle = (t: string) => {
    ensure(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text(t, MARGIN, state.y);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(1.5);
    doc.line(MARGIN, state.y + 4, MARGIN + 26, state.y + 4);
    doc.setLineWidth(0.5);
    state.y += 18;
  };

  const masteryTable = (rows: MasteryRow[]) => {
    if (rows.length === 0) return;
    rows.forEach((r) => {
      ensure(20);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(r.label.length > 46 ? r.label.slice(0, 45) + "…" : r.label, MARGIN, state.y);
      // Bar.
      const barX = MARGIN + 230;
      const barW = 150;
      doc.setFillColor(...LINE);
      doc.roundedRect(barX, state.y - 8, barW, 7, 2, 2, "F");
      doc.setFillColor(...bandColor(r.band));
      doc.roundedRect(barX, state.y - 8, Math.max(2, (Math.min(100, r.accuracy) / 100) * barW), 7, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...bandColor(r.band));
      doc.text(`${r.accuracy}%`, barX + barW + 10, state.y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...GREY);
      doc.setFontSize(8);
      doc.text(`${r.correct}/${r.attempted} · ${r.quizzes}q`, barX + barW + 44, state.y);
      state.y += 16;
    });
    state.y += 6;
  };

  sectionTitle("Subject mastery");
  masteryTable(data.subjects.slice(0, 12));

  if (data.topics.length) {
    sectionTitle("Topic mastery (weakest first)");
    masteryTable(data.topics.slice(0, 12));
  }

  // Best & weakest quizzes.
  sectionTitle("Quiz-wise scores");
  const qRows = data.quizzes.slice(0, 12);
  qRows.forEach((q) => {
    ensure(18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(q.title.length > 48 ? q.title.slice(0, 47) + "…" : q.title, MARGIN, state.y);
    doc.setTextColor(...GREY);
    doc.setFontSize(8.5);
    doc.text(fmtDate(q.dateISO), MARGIN + 300, state.y);
    doc.text(`${q.score}/${q.maxScore}`, MARGIN + 380, state.y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...accColor(q.accuracy));
    doc.text(`${q.accuracy}%`, MARGIN + 450, state.y);
    state.y += 15;
  });
  state.y += 6;

  // Accuracy trend sparkline.
  if (data.trend.length >= 2) {
    sectionTitle(`Accuracy trend — ${data.trendDirection}`);
    ensure(70);
    const boxX = MARGIN, boxY = state.y, boxW = contentW, boxH = 56;
    doc.setDrawColor(...LINE);
    doc.roundedRect(boxX, boxY, boxW, boxH, 4, 4, "S");
    const pts = data.trend.map((p, i) => {
      const x = boxX + 10 + (i / (data.trend.length - 1)) * (boxW - 20);
      const y = boxY + boxH - 8 - (Math.min(100, p.accuracy) / 100) * (boxH - 16);
      return [x, y] as [number, number];
    });
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(1.5);
    for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    doc.setFillColor(...GOLD);
    pts.forEach((p) => doc.circle(p[0], p[1], 1.5, "F"));
    doc.setLineWidth(0.5);
    state.y += boxH + 10;
  }

  // Focus areas.
  if (data.focusTopics.length || data.mostMissed.length) {
    sectionTitle("What to work on");
    if (data.focusTopics.length) {
      const priority = data.focusTopics.slice(0, 3).map((t) => t.label).join(", ");
      ensure(16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      const lines = doc.splitTextToSize(`Prioritize: ${priority}`, contentW);
      doc.text(lines, MARGIN, state.y);
      state.y += lines.length * 12 + 6;
      data.focusTopics.forEach((t) => {
        ensure(14);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...GREY);
        doc.text(`• ${t.label} — ${t.accuracy}% (${t.incorrect} wrong of ${t.attempted})`, MARGIN + 4, state.y);
        state.y += 13;
      });
      state.y += 4;
    }
    if (data.mostMissed.length) {
      ensure(14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...NAVY);
      doc.text("Most-missed questions", MARGIN, state.y);
      state.y += 14;
      data.mostMissed.forEach((m) => {
        ensure(16);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...INK);
        const label = `• ${m.text}${m.wrong > 1 ? ` (missed ${m.wrong}×)` : ""}`;
        const lines = doc.splitTextToSize(label, contentW - 4);
        doc.text(lines, MARGIN + 4, state.y);
        state.y += lines.length * 11 + 2;
      });
    }
  }

  addFooter(doc);
  doc.save(`overall-performance-${safeName(data.studentName)}.pdf`);
}

/* ------------------------------- LEADERBOARD ------------------------------- */
export async function downloadLeaderboardPdf(input: {
  batchLabel: string;
  snapshotISO: string;
  studentCount: number;
  rows: LeaderboardRow[];
}) {
  const { doc, state } = await makeDoc("l");
  const contentW = state.pageW - MARGIN * 2;

  // Header band.
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, state.pageW, 74, "F");
  doc.setTextColor(...GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("BATCH PERFORMANCE LEADERBOARD", MARGIN, 28);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(input.batchLabel, MARGIN, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(210, 216, 230);
  doc.text(`${input.studentCount} students   •   Snapshot: ${fmtDate(input.snapshotISO)}`, MARGIN, 66);
  state.y = 96;

  // Column layout.
  const cols = [
    { key: "rank", label: "#", w: 26 },
    { key: "name", label: "Student", w: 150 },
    { key: "batch", label: "Batch", w: 150 },
    { key: "quizzes", label: "Quizzes", w: 55 },
    { key: "accuracy", label: "Accuracy", w: 65 },
    { key: "attempt", label: "Attempt%", w: 65 },
    { key: "top", label: "Top subject", w: 120 },
    { key: "weak", label: "Weak subject", w: 120 },
  ];
  const totalW = cols.reduce((a, c) => a + c.w, 0);
  const scale = contentW / totalW;

  const drawHeaderRow = () => {
    doc.setFillColor(245, 246, 249);
    doc.rect(MARGIN, state.y - 12, contentW, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    let x = MARGIN;
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x + 4, state.y + 2);
      x += c.w * scale;
    }
    state.y += 16;
  };
  drawHeaderRow();

  input.rows.forEach((r, i) => {
    if (state.y + 18 > state.pageH - MARGIN) {
      doc.addPage();
      state.y = MARGIN;
      drawHeaderRow();
    }
    if (i % 2 === 1) {
      doc.setFillColor(250, 251, 253);
      doc.rect(MARGIN, state.y - 10, contentW, 16, "F");
    }
    let x = MARGIN;
    const cell = (text: string, w: number, color: [number, number, number] = INK, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...color);
      const maxChars = Math.floor((w * scale - 8) / 4.6);
      doc.text(text.length > maxChars ? text.slice(0, Math.max(1, maxChars - 1)) + "…" : text, x + 4, state.y + 1);
      x += w * scale;
    };
    cell(String(i + 1), cols[0].w, i < 3 ? GOLD : GREY, i < 3);
    cell(r.name, cols[1].w, INK, i < 3);
    cell(r.batchLabel || "—", cols[2].w, GREY);
    if (r.hasData) {
      cell(String(r.quizzes), cols[3].w);
      cell(`${r.accuracy}%`, cols[4].w, accColor(r.accuracy), true);
      cell(`${r.attemptRate}%`, cols[5].w);
      cell(r.topSubject ? `${r.topSubject.label} (${r.topSubject.accuracy}%)` : "—", cols[6].w, GREEN);
      cell(r.weakSubject ? `${r.weakSubject.label} (${r.weakSubject.accuracy}%)` : "—", cols[7].w, RED);
    } else {
      cell("no attempts yet", cols[3].w + cols[4].w + cols[5].w + cols[6].w + cols[7].w, GREY);
    }
    state.y += 16;
  });

  addFooter(doc);
  doc.save(`leaderboard-${safeName(input.batchLabel)}.pdf`);
}

function addFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text("Naman IAS Academy — performance report", MARGIN, ph - 18);
    doc.text(`Page ${i} of ${pages}`, pw - MARGIN - 50, ph - 18);
  }
}
