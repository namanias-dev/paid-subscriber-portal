import type { CustomerStage } from "./projection";

export const ISSUE_CATEGORIES = [
  "ADDRESS_ISSUE",
  "DELIVERY_DELAY",
  "PICKUP_ISSUE",
  "TRACKING_ISSUE",
  "STATUS_MISMATCH",
  "DAMAGE_ISSUE",
  "UPDATE_REQUEST",
  "OTHER",
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const ISSUE_STATUSES = ["OPEN", "IN_REVIEW", "WAITING_ON_TEAM", "RESOLVED", "CLOSED"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const OPEN_ISSUE_STATUSES: IssueStatus[] = ["OPEN", "IN_REVIEW", "WAITING_ON_TEAM"];

const CATEGORY_LABEL: Record<IssueCategory, string> = {
  ADDRESS_ISSUE: "Address issue",
  DELIVERY_DELAY: "Delivery delayed",
  PICKUP_ISSUE: "Pickup not done",
  TRACKING_ISSUE: "Tracking problem",
  STATUS_MISMATCH: "Wrong status shown",
  DAMAGE_ISSUE: "Package damaged",
  UPDATE_REQUEST: "Update phone or address",
  OTHER: "Something else",
};

const STATUS_LABEL: Record<IssueStatus, string> = {
  OPEN: "Issue received",
  IN_REVIEW: "In review",
  WAITING_ON_TEAM: "With our team",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

const STATUS_NEXT: Record<IssueStatus, string> = {
  OPEN: "We've received this and will review it. We'll update this page when there is progress.",
  IN_REVIEW: "Our team is looking at this now. You don't need to raise it again.",
  WAITING_ON_TEAM: "This is with the academy team. We'll update this page when there is progress.",
  RESOLVED: "This issue is resolved. Raise a new one only if something else comes up.",
  CLOSED: "This issue is closed. Raise a new one only if something else comes up.",
};

export interface PublicIssue {
  reference: string;
  category: IssueCategory;
  category_label: string;
  description: string;
  status: IssueStatus;
  status_label: string;
  created_at: string;
  updated_at: string;
  customer_note: string | null;
  next_step: string;
  open: boolean;
  callback_requested: boolean;
}

export function issueCategoryAllowed(value: string): value is IssueCategory {
  return (ISSUE_CATEGORIES as readonly string[]).includes(value);
}

export function issueStatusAllowed(value: string): value is IssueStatus {
  return (ISSUE_STATUSES as readonly string[]).includes(value);
}

export function issueIsOpen(status: string): boolean {
  return (OPEN_ISSUE_STATUSES as readonly string[]).includes(status);
}

export function issueCategoryLabel(category: string): string {
  return issueCategoryAllowed(category) ? CATEGORY_LABEL[category] : "Issue";
}

export function issueStatusLabel(status: string): string {
  return issueStatusAllowed(status) ? STATUS_LABEL[status] : "Issue received";
}

export function issueNextStep(status: string): string {
  return issueStatusAllowed(status) ? STATUS_NEXT[status] : STATUS_NEXT.OPEN;
}

/** Categories that make sense for the stage the student is looking at. */
export function categoriesForStage(stage: CustomerStage): IssueCategory[] {
  const base: IssueCategory[] = ["ADDRESS_ISSUE", "UPDATE_REQUEST", "STATUS_MISMATCH", "TRACKING_ISSUE", "OTHER"];
  if (stage === "packed" || stage === "confirmed" || stage === "preparing" || stage === "pending") {
    return ["PICKUP_ISSUE", "ADDRESS_ISSUE", "UPDATE_REQUEST", "STATUS_MISMATCH", "TRACKING_ISSUE", "OTHER"];
  }
  if (stage === "shipped" || stage === "in_transit" || stage === "out_for_delivery" || stage === "delivery_issue") {
    return ["DELIVERY_DELAY", "PICKUP_ISSUE", "ADDRESS_ISSUE", "TRACKING_ISSUE", "STATUS_MISMATCH", "UPDATE_REQUEST", "OTHER"];
  }
  if (stage === "delivered" || stage === "return_open" || stage === "returning") {
    return ["DAMAGE_ISSUE", "DELIVERY_DELAY", "ADDRESS_ISSUE", "TRACKING_ISSUE", "STATUS_MISMATCH", "OTHER"];
  }
  return base;
}

export function clampIssueText(value: string, max = 600): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function toPublicIssue(row: {
  reference: string;
  category: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  customer_note?: string | null;
  callback_requested?: boolean | null;
}): PublicIssue {
  const status = issueStatusAllowed(row.status) ? row.status : "OPEN";
  const category = issueCategoryAllowed(row.category) ? row.category : "OTHER";
  return {
    reference: row.reference,
    category,
    category_label: CATEGORY_LABEL[category],
    description: row.description,
    status,
    status_label: STATUS_LABEL[status],
    created_at: row.created_at,
    updated_at: row.updated_at,
    customer_note: row.customer_note?.trim() || null,
    next_step: STATUS_NEXT[status],
    open: issueIsOpen(status),
    callback_requested: !!row.callback_requested,
  };
}
