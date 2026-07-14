/**
 * Node catalog for the Journey Automation visual builder (Version-1 node set).
 *
 * Authoring/config only — NONE of these are executable this shipment. Trigger
 * availability reflects the Part-A event-capture spike: only PROVEN-capturable
 * events are "available"; the rest are "coming soon" (disabled) so staff are never
 * misled into building on an event we cannot yet capture.
 */
import type { NodeType } from "@/types/journey-automation";

export type NodeGroup =
  | "Triggers"
  | "Conditions"
  | "Timing"
  | "Communications"
  | "Staff Tasks"
  | "Logic"
  | "Goals"
  | "Exit";

export interface NodeCatalogItem {
  /** Palette key. For triggers this encodes the event type. */
  key: string;
  type: NodeType;
  group: NodeGroup;
  label: string;
  description: string;
  /** lucide-react icon name (rendered by the client). */
  icon: string;
  available: boolean;
  comingSoonReason?: string;
  defaultConfig: Record<string, unknown>;
}

/** Trigger events PROVEN capturable by the Part-A spike (wired ingestion). */
export const AVAILABLE_TRIGGER_EVENTS = [
  "payment_received",
  "installment_overdue",
  "webinar_registered",
] as const;

export const NODE_CATALOG: NodeCatalogItem[] = [
  // --- Triggers (availability from the Part-A spike) ---
  { key: "trigger:payment_received", type: "trigger", group: "Triggers", label: "Payment received", description: "A verified payment was captured.", icon: "IndianRupee", available: true, defaultConfig: { title: "Payment received", eventType: "payment_received" } },
  { key: "trigger:installment_overdue", type: "trigger", group: "Triggers", label: "Installment overdue", description: "An EMI installment passed its due date.", icon: "CalendarClock", available: true, defaultConfig: { title: "Installment overdue", eventType: "installment_overdue" } },
  { key: "trigger:webinar_registered", type: "trigger", group: "Triggers", label: "Webinar registered", description: "A student registered for a webinar.", icon: "CalendarCheck", available: true, defaultConfig: { title: "Webinar registered", eventType: "webinar_registered" } },
  { key: "trigger:lead_created", type: "trigger", group: "Triggers", label: "Lead registered", description: "A new lead entered the funnel.", icon: "UserPlus", available: false, comingSoonReason: "Event capture not yet wired.", defaultConfig: { title: "Lead registered", eventType: "lead_created" } },
  { key: "trigger:payment_failed", type: "trigger", group: "Triggers", label: "Payment failed", description: "A payment attempt failed.", icon: "CircleX", available: false, comingSoonReason: "Event capture not yet wired.", defaultConfig: { title: "Payment failed", eventType: "payment_failed" } },
  { key: "trigger:proof_uploaded", type: "trigger", group: "Triggers", label: "Proof uploaded", description: "A payment proof was uploaded.", icon: "FileUp", available: false, comingSoonReason: "Event capture not yet wired.", defaultConfig: { title: "Proof uploaded", eventType: "proof_uploaded" } },
  { key: "trigger:course_enrolled", type: "trigger", group: "Triggers", label: "Course enrolled", description: "A student enrolled in a course.", icon: "GraduationCap", available: false, comingSoonReason: "Event capture not yet wired.", defaultConfig: { title: "Course enrolled", eventType: "course_enrolled" } },
  { key: "trigger:webinar_attended", type: "trigger", group: "Triggers", label: "Webinar attended", description: "A registrant attended a webinar.", icon: "Video", available: false, comingSoonReason: "Attendance capture not yet wired.", defaultConfig: { title: "Webinar attended", eventType: "webinar_attended" } },
  { key: "trigger:webinar_missed", type: "trigger", group: "Triggers", label: "Webinar missed", description: "A registrant did not attend.", icon: "VideoOff", available: false, comingSoonReason: "Attendance capture not yet wired.", defaultConfig: { title: "Webinar missed", eventType: "webinar_missed" } },

  // --- Conditions ---
  { key: "condition:yesno", type: "condition", group: "Conditions", label: "Yes / No condition", description: "Split the path on a true/false check.", icon: "GitBranch", available: true, defaultConfig: { title: "Condition", field: "", operator: "eq", value: "" } },

  // --- Timing ---
  { key: "wait", type: "wait", group: "Timing", label: "Wait", description: "Pause before the next step.", icon: "Timer", available: true, defaultConfig: { title: "Wait", durationValue: 1, durationUnit: "days" } },

  // --- Communications ---
  { key: "send_sms", type: "send_sms", group: "Communications", label: "Send SMS", description: "Send an approved DLT template (config only).", icon: "MessageSquare", available: true, defaultConfig: { title: "Send SMS", automationTemplateId: null, quietHours: { start: "21:00", end: "08:00" }, frequencyCap: { perDays: 1, max: 1 }, variableMapping: {} } },

  // --- Staff Tasks ---
  { key: "staff_task", type: "staff_task", group: "Staff Tasks", label: "Staff task", description: "Create a task for the team to action.", icon: "ClipboardList", available: true, defaultConfig: { title: "Staff task", assignee: "", details: "" } },

  // --- Logic ---
  { key: "branch", type: "branch", group: "Logic", label: "Branch", description: "Split into multiple labelled paths.", icon: "Split", available: true, defaultConfig: { title: "Branch", branches: ["A", "B"] } },

  // --- Goals ---
  { key: "goal", type: "goal", group: "Goals", label: "Goal", description: "The outcome this journey optimizes for.", icon: "Target", available: true, defaultConfig: { title: "Goal", goalType: "payment_completed" } },

  // --- Exit ---
  { key: "exit", type: "exit", group: "Exit", label: "Stop / Exit", description: "End the journey for this student.", icon: "OctagonMinus", available: true, defaultConfig: { title: "Exit" } },
];

export const NODE_GROUPS: NodeGroup[] = [
  "Triggers", "Conditions", "Timing", "Communications", "Staff Tasks", "Logic", "Goals", "Exit",
];

export function catalogByKey(key: string): NodeCatalogItem | undefined {
  return NODE_CATALOG.find((n) => n.key === key);
}

/** Visual accent per node type (brand-aligned). */
export const NODE_ACCENT: Record<string, string> = {
  trigger: "var(--primary)",
  condition: "#7c3aed",
  wait: "#0891b2",
  send_sms: "var(--gold)",
  staff_task: "#0d9488",
  branch: "#7c3aed",
  goal: "#16a34a",
  exit: "var(--danger)",
};

export const NODE_ICON: Record<string, string> = {
  trigger: "Zap",
  condition: "GitBranch",
  wait: "Timer",
  send_sms: "MessageSquare",
  staff_task: "ClipboardList",
  branch: "Split",
  goal: "Target",
  exit: "OctagonMinus",
};
