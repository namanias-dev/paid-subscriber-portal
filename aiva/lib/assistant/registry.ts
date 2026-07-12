import {
  getCollectionsSummary,
  getOverdueStudents,
  getWebinarPerformance,
  getBatchFill,
  getEnrollmentsTrend,
  getZeroContactStudents,
  getAttentionItems,
  getStudent360,
  getRevenueAging,
} from "./tools";
import type { ToolResult } from "./types";

/**
 * The WHITELIST. The LLM may only ever call a tool named here, with these params. Anything
 * outside this map is impossible to invoke (no raw SQL, no ad-hoc reads). Each entry carries a
 * JSON-schema-ish param spec used to build the provider's function-calling definitions.
 */

export type ToolParam = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
  enum?: string[];
};

export type ToolSpec = {
  name: string;
  description: string;
  params: ToolParam[];
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
};

function str(args: Record<string, unknown>, key: string, def = ""): string {
  const v = args[key];
  return v == null ? def : String(v);
}
function num(args: Record<string, unknown>, key: string, def: number): number {
  const v = Number(args[key]);
  return Number.isFinite(v) ? v : def;
}
function boolArg(args: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = args[key];
  if (v === undefined || v === null || v === "") return def;
  return v === true || v === "true" || v === 1 || v === "1";
}

export const TOOLS: Record<string, ToolSpec> = {
  getCollectionsSummary: {
    name: "getCollectionsSummary",
    description: "Money COLLECTED over a period with a comparison to the previous period, all-time collected, and collection rate. Use for questions about revenue/collections/how much money came in this week/month.",
    params: [
      { name: "period", type: "string", description: "Rolling window: 'week' (7d), 'month' (30d), or 'quarter' (90d).", enum: ["week", "month", "quarter"] },
      { name: "comparePrevious", type: "boolean", description: "Include the previous period comparison (default true)." },
    ],
    run: (a) => getCollectionsSummary(str(a, "period", "week"), boolArg(a, "comparePrevious", true)),
  },
  getOverdueStudents: {
    name: "getOverdueStudents",
    description: "Students/installments overdue by at least N days, with the unpaid amount and the record list. Use for 'who is overdue', 'overdue 15+ days', 'late payments'.",
    params: [{ name: "minDaysOverdue", type: "number", description: "Minimum days overdue (e.g. 1, 8, 15). Default 1." }],
    run: (a) => getOverdueStudents(num(a, "minDaysOverdue", 1)),
  },
  getWebinarPerformance: {
    name: "getWebinarPerformance",
    description: "Per-webinar registrants → converted → paid with conversion %, and best/worst converting webinar. Use for 'which webinar converted best/worst', 'webinar performance'.",
    params: [],
    run: () => getWebinarPerformance(),
  },
  getBatchFill: {
    name: "getBatchFill",
    description: "Per-batch seat fill: enrolled vs capacity, start date, booking pace, projected fill (ESTIMATE), and the slowest-filling batch. Use for 'which batch is filling slowest', 'seat fill', 'batch timeline'.",
    params: [],
    run: () => getBatchFill(),
  },
  getEnrollmentsTrend: {
    name: "getEnrollmentsTrend",
    description: "NEW enrollments this period vs the previous period with delta % and a webinar-vs-direct cohort split. Use for 'enrollments this month vs last', 'admissions trend'.",
    params: [{ name: "period", type: "string", description: "'week' (7d) or 'month' (30d). Default month.", enum: ["week", "month"] }],
    run: (a) => getEnrollmentsTrend(str(a, "period", "month")),
  },
  getZeroContactStudents: {
    name: "getZeroContactStudents",
    description: "Active enrolled students who have never received an SMS. Use for 'who has never been contacted', 'students with no SMS'.",
    params: [],
    run: () => getZeroContactStudents(),
  },
  getAttentionItems: {
    name: "getAttentionItems",
    description: "Ranked, explainable attention flags (biggest risks first) from the same reconciliation truth. Use for 'what needs my attention', 'what should I look at today', 'any problems'.",
    params: [],
    run: () => getAttentionItems(),
  },
  getStudent360: {
    name: "getStudent360",
    description: "One student's stitched timeline: registered → attended → enrolled → paid, plus SMS history and amounts. Use when the user names a specific student or gives a phone number.",
    params: [{ name: "query", type: "string", description: "Student name (substring) or phone (last 4+ digits).", required: true }],
    run: (a) => getStudent360(str(a, "query", "")),
  },
  getRevenueAging: {
    name: "getRevenueAging",
    description: "Overdue aging buckets (due today / 1–3 / 4–7 / 8+ days) and abandoned checkouts, with total at-risk revenue and the record lists. Use for 'revenue aging', 'how much is at risk', 'overdue breakdown'.",
    params: [],
    run: () => getRevenueAging(),
  },
};

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS);

/** Execute a whitelisted tool by name. Throws only if the name is not whitelisted. */
export async function runTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const spec = TOOLS[name];
  if (!spec) throw new Error(`Tool not whitelisted: ${name}`);
  return spec.run(args);
}
