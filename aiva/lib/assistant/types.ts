import type { DrillRow } from "@/lib/insights/drill";
import type { PortalLink } from "@/lib/portal/links";

/** A labelled headline figure the assistant may state (always sourced from a tool). */
export type ToolFigure = { label: string; value: string; hint?: string };

/** A pointer to the full drill-down list behind a tool result (opens the shared panel). */
export type DrillRef = { domain: string; metric: string; label: string };

/**
 * The uniform, strongly-typed shape EVERY read-only data tool returns: the headline figure(s),
 * the evidence rows behind them, a provenance note (which primitives/tables produced it), portal
 * deep-links, and any honesty notes (probable/estimate/unknown). No tool ever writes.
 */
export type ToolResult = {
  tool: string;
  ok: boolean;
  /** Plain-English, data-derived takeaway. Never invented — templated from the numbers below. */
  headline: string;
  figures: ToolFigure[];
  /** Evidence: a page of the stitched records behind the numbers (may be empty). */
  rows: DrillRow[];
  /** Total records behind `rows` (rows is capped to a page). */
  rowsTotal: number;
  /** Opens the full paginated/searchable drill panel for these records, when available. */
  drill: DrillRef | null;
  links: PortalLink[];
  provenance: string;
  notes: string[];
};

export type ChatRole = "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

/** The engine's structured answer for one turn (streamed answer text + this payload). */
export type AssistantTurn = {
  answer: string;
  tool: string | null;
  figures: ToolFigure[];
  rows: DrillRow[];
  rowsTotal: number;
  drill: DrillRef | null;
  links: PortalLink[];
  provenance: string | null;
  notes: string[];
  followups: string[];
  /** How the tool was chosen: deterministic router or the LLM planner. */
  planner: "router" | "llm" | "none";
  refused: boolean;
};
