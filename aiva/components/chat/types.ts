import type { DrillRow } from "@/lib/insights/drill";
import type { PortalLink } from "@/lib/portal/links";

export type Figure = { label: string; value: string; hint?: string };
export type DrillRef = { domain: string; metric: string; label: string };

export type DonePayload = {
  tool: string | null;
  figures: Figure[];
  rows: DrillRow[];
  rowsTotal: number;
  drill: DrillRef | null;
  links: PortalLink[];
  provenance: string | null;
  notes: string[];
  followups: string[];
  refused: boolean;
};

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: boolean;
  payload?: DonePayload;
};
