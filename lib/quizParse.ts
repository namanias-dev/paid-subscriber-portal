import type { QuizOptionKey, QuizDifficulty } from "./types";

/**
 * Bulk-paste question parser for the admin Question Bank.
 * Expected format (one or more blocks separated by a blank line):
 *
 *   Q1. Which Article ... ?
 *   A. Option one
 *   B. Option two
 *   C. Option three
 *   D. Option four
 *   Answer: C
 *   Explanation: Article 32 ...
 *   Subject: Polity
 *   Topic: Fundamental Rights
 *   Difficulty: Easy
 *   Tags: constitution, rights
 *
 * Never imports broken rows silently — each row is validated and returned with
 * an `error` when invalid so the admin can fix it in the preview.
 */

export interface ParsedQuestion {
  index: number;
  question_html: string;
  options: { A: string; B: string; C: string; D: string; E?: string | null };
  correct_option: QuizOptionKey;
  explanation_html: string | null;
  subject: string | null;
  topic: string | null;
  difficulty: QuizDifficulty;
  tags: string[];
  valid: boolean;
  error?: string;
}

const OPTION_RE = /^\(?\s*([A-Ea-e])\s*[\.\):-]\s*(.+)$/;
const ANSWER_RE = /^(?:Answer|Ans|Correct(?:\s*Answer)?)\s*[:\-]\s*\(?\s*([A-Ea-e])/i;
const FIELD_RE = /^(Explanation|Subject|Topic|Subtopic|Difficulty|Tags)\s*[:\-]\s*(.*)$/i;
const QSTART_RE = /^(?:Q\s*\d*|[0-9]+)\s*[\.\):]\s*(.*)$/i;

const DIFFICULTIES: QuizDifficulty[] = ["Easy", "Moderate", "Difficult", "UPSC-level"];

function normalizeDifficulty(raw: string): QuizDifficulty {
  const v = raw.trim().toLowerCase();
  if (v.startsWith("easy")) return "Easy";
  if (v.startsWith("hard") || v.startsWith("diff")) return "Difficult";
  if (v.startsWith("upsc")) return "UPSC-level";
  const exact = DIFFICULTIES.find((d) => d.toLowerCase() === v);
  return exact || "Moderate";
}

/** Split raw text into question blocks. Blocks are delimited by blank lines OR a new "Q." marker. */
function splitBlocks(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[][] = [];
  let current: string[] = [];

  const isQStart = (l: string) => QSTART_RE.test(l.trim()) && !OPTION_RE.test(l.trim());

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    if (isQStart(trimmed) && current.length && current.some((c) => OPTION_RE.test(c.trim()))) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function parseBlock(block: string[], index: number): ParsedQuestion {
  const base: ParsedQuestion = {
    index,
    question_html: "",
    options: { A: "", B: "", C: "", D: "" },
    correct_option: "A",
    explanation_html: null,
    subject: null,
    topic: null,
    difficulty: "Moderate",
    tags: [],
    valid: false,
  };

  const questionLines: string[] = [];
  let answer: QuizOptionKey | null = null;
  let mode: "question" | "explanation" | "other" = "question";

  for (const rawLine of block) {
    const line = rawLine.trim();
    if (!line) continue;

    const opt = line.match(OPTION_RE);
    if (opt) {
      const key = opt[1].toUpperCase() as QuizOptionKey;
      const val = opt[2].trim();
      if (key === "E") base.options.E = val;
      else base.options[key] = val;
      mode = "other";
      continue;
    }

    const ans = line.match(ANSWER_RE);
    if (ans) {
      answer = ans[1].toUpperCase() as QuizOptionKey;
      mode = "other";
      continue;
    }

    const field = line.match(FIELD_RE);
    if (field) {
      const name = field[1].toLowerCase();
      const value = field[2].trim();
      if (name === "explanation") {
        base.explanation_html = value;
        mode = "explanation";
      } else if (name === "subject") base.subject = value || null;
      else if (name === "topic") base.topic = value || null;
      else if (name === "subtopic") { /* stored within topic chain later if needed */ }
      else if (name === "difficulty") base.difficulty = normalizeDifficulty(value);
      else if (name === "tags") base.tags = value.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
      continue;
    }

    if (mode === "question") {
      const q = line.match(QSTART_RE);
      questionLines.push(q ? q[1] : line);
    } else if (mode === "explanation") {
      // Preserve line breaks within multi-line explanations.
      base.explanation_html = `${base.explanation_html ? base.explanation_html + "\n" : ""}${line}`.trim();
    }
  }

  // Join with newlines so UPSC statement-style line breaks survive to the student view.
  base.question_html = questionLines.join("\n").trim();
  if (answer) base.correct_option = answer;

  // Validate.
  const missing: string[] = [];
  if (!base.question_html) missing.push("question text");
  if (!base.options.A || !base.options.B || !base.options.C || !base.options.D) missing.push("options A–D");
  if (!answer) missing.push("answer");
  else if (!base.options[answer]) missing.push(`option ${answer} (referenced by Answer)`);

  if (missing.length) {
    base.error = `Missing/invalid: ${missing.join(", ")}.`;
    base.valid = false;
  } else {
    base.valid = true;
  }
  return base;
}

export function parseBulkQuestions(text: string): ParsedQuestion[] {
  const blocks = splitBlocks(text || "");
  return blocks.map((b, i) => parseBlock(b, i + 1)).filter((p) => p.question_html || p.options.A || p.error);
}

/** Stable hash of the question text for duplicate detection. */
export function questionHash(questionHtml: string): string {
  const norm = (questionHtml || "")
    .replace(/<[^>]*>/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  return `h${h.toString(16)}`;
}
