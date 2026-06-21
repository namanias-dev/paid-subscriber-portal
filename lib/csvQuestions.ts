import type { ParsedQuestion } from "./quizParse";
import type { QuizOptionKey, QuizDifficulty } from "./types";

/** Minimal RFC-4180-ish CSV/TSV parser (handles quoted fields & embedded delimiters). */
export function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  const t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delimiter = t.split("\n")[0]?.includes("\t") && !t.split("\n")[0]?.includes(",") ? "\t" : ",";
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function normDifficulty(raw: string): QuizDifficulty {
  const v = (raw || "").trim().toLowerCase();
  if (v.startsWith("easy")) return "Easy";
  if (v.startsWith("hard") || v.startsWith("diff")) return "Difficult";
  if (v.startsWith("upsc")) return "UPSC-level";
  return "Moderate";
}

const ALIASES: Record<string, string[]> = {
  question: ["questiontext", "question", "questionhtml", "question_html", "q"],
  a: ["optiona", "option_a", "a"],
  b: ["optionb", "option_b", "b"],
  c: ["optionc", "option_c", "c"],
  d: ["optiond", "option_d", "d"],
  e: ["optione", "option_e", "e"],
  correct: ["correctoption", "correct_option", "answer", "correct", "ans"],
  explanation: ["explanation", "explanationhtml", "explanation_html"],
  subject: ["subject"],
  topic: ["topic"],
  subtopic: ["subtopic", "sub_topic"],
  difficulty: ["difficulty", "level"],
  tags: ["tags"],
  source: ["source"],
  ispyq: ["ispyq", "is_pyq", "pyq"],
  pyqyear: ["pyqyear", "pyq_year"],
};

function buildIndex(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    const key = h.trim().toLowerCase().replace(/\s+/g, "");
    for (const [canonical, names] of Object.entries(ALIASES)) {
      if (names.includes(key)) map[canonical] = i;
    }
  });
  return map;
}

export function parseCsvQuestions(text: string): ParsedQuestion[] {
  const rows = parseDelimited(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = buildIndex(headers);
  const get = (row: string[], key: string) => (idx[key] != null ? (row[idx[key]] || "").trim() : "");

  return rows.slice(1).map((row, i) => {
    const question_html = get(row, "question");
    const options = {
      A: get(row, "a"), B: get(row, "b"), C: get(row, "c"), D: get(row, "d"),
      E: get(row, "e") || null,
    };
    const correctRaw = get(row, "correct").toUpperCase().replace(/[^A-E]/g, "");
    const correct = (["A", "B", "C", "D", "E"].includes(correctRaw) ? correctRaw : "") as QuizOptionKey | "";
    const tags = get(row, "tags").split(/[,;|]/).map((t) => t.trim()).filter(Boolean);

    const p: ParsedQuestion = {
      index: i + 1,
      question_html,
      options,
      correct_option: (correct || "A") as QuizOptionKey,
      explanation_html: get(row, "explanation") || null,
      subject: get(row, "subject") || null,
      topic: get(row, "topic") || null,
      difficulty: normDifficulty(get(row, "difficulty")),
      tags,
      valid: false,
    };

    const missing: string[] = [];
    if (!p.question_html) missing.push("question");
    if (!options.A || !options.B || !options.C || !options.D) missing.push("options A–D");
    if (!correct) missing.push("correctOption (A-D)");
    else if (!options[correct as "A" | "B" | "C" | "D"]) missing.push(`option ${correct}`);
    if (missing.length) p.error = `Missing/invalid: ${missing.join(", ")}.`;
    else p.valid = true;
    return p;
  });
}
