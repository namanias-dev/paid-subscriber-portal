/**
 * Node catalog for the Journey Automation visual builder.
 *
 * Every node listed here is FULLY configurable and behaves correctly in
 * simulation. Triggers listed are PROVEN-capturable (their ingestion is wired at
 * a real business call-site). Events we cannot yet capture are intentionally
 * absent from the library rather than shown as dead "coming soon" tiles.
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
  | "Exit"
  | "Annotations";

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

/**
 * Trigger events with a wired, idempotent ingestion at a real business
 * call-site. These are the only triggers offered in the library.
 */
export const AVAILABLE_TRIGGER_EVENTS = [
  "lead_created",
  "payment_received",
  "installment_overdue",
  "webinar_registered",
] as const;

/**
 * Condition checks the engine can actually evaluate against live business truth
 * (latest-state revalidation). The inspector renders these as a dropdown so a
 * staffer can never author a check the engine cannot answer.
 */
export const CONDITION_CHECKS: { value: string; label: string; help: string }[] = [
  { value: "has_logged_in", label: "Has logged into the portal?", help: "True once the student/buyer has signed in at least once." },
  { value: "is_paid", label: "Has fully paid?", help: "True when the course fee is fully collected." },
  { value: "has_overdue", label: "Has an overdue installment?", help: "True when an EMI is past its due date." },
  { value: "registered_for_webinar", label: "Registered for a webinar?", help: "True when registered for the target (or any) webinar." },
  { value: "enrolled_in_course", label: "Enrolled in a course?", help: "True when there is an active course enrollment." },
  { value: "plan_paused_or_waived", label: "Plan paused or fee waived?", help: "True when dunning should be suppressed." },
  { value: "opted_out", label: "Opted out of SMS?", help: "True when the contact has opted out." },
];

/** SMS send categories (drive suppression + per-category pause at execution). */
export const SMS_CATEGORIES: { value: string; label: string; help: string }[] = [
  { value: "transactional", label: "Transactional", help: "Account/service messages (welcome, login, confirmations)." },
  { value: "promotional", label: "Promotional", help: "Marketing/nurture (webinar invites, offers). Respects promo flag." },
  { value: "payment_reminder", label: "Payment reminder", help: "Dunning. Auto-suppressed once paid / no overdue / plan paused." },
];

/** Goal outcomes the engine can measure against live business truth. */
export const GOAL_TYPES: { value: string; label: string }[] = [
  { value: "payment_completed", label: "Payment completed" },
  { value: "course_enrolled", label: "Course enrolled" },
  { value: "webinar_registered", label: "Webinar registered" },
  { value: "logged_in", label: "Logged into portal" },
];

/** Journey variables resolvable at execution time (mapped onto DLT placeholders). */
export const JOURNEY_VARIABLES: { value: string; label: string; secret?: boolean }[] = [
  { value: "first_name", label: "First name" },
  { value: "name", label: "Full name" },
  { value: "phone", label: "Phone" },
  { value: "item_short", label: "Course / webinar (short)" },
  { value: "webinar_title", label: "Webinar title" },
  { value: "webinar_time", label: "Webinar time" },
  { value: "course_name", label: "Course name" },
  { value: "amount_due", label: "Amount due" },
  { value: "due_date", label: "Due date" },
  { value: "date", label: "Date" },
  { value: "login_code", label: "Login code (resolved live)", secret: true },
  { value: "login_url", label: "Login URL (resolved live)", secret: true },
  { value: "portal_login_url", label: "Portal login URL (resolved live)", secret: true },
];

export const NODE_CATALOG: NodeCatalogItem[] = [
  // --- Triggers (all wired + idempotently ingested at a real call-site) ---
  { key: "trigger:lead_created", type: "trigger", group: "Triggers", label: "Lead registered", description: "A new lead entered the funnel (any lead-capture form).", icon: "UserPlus", available: true, defaultConfig: { title: "Lead registered", eventType: "lead_created" } },
  { key: "trigger:payment_received", type: "trigger", group: "Triggers", label: "Payment received", description: "A verified payment was captured.", icon: "IndianRupee", available: true, defaultConfig: { title: "Payment received", eventType: "payment_received" } },
  { key: "trigger:installment_overdue", type: "trigger", group: "Triggers", label: "Installment overdue", description: "An EMI installment passed its due date.", icon: "CalendarClock", available: true, defaultConfig: { title: "Installment overdue", eventType: "installment_overdue" } },
  { key: "trigger:webinar_registered", type: "trigger", group: "Triggers", label: "Webinar registered", description: "A student registered for a webinar.", icon: "CalendarCheck", available: true, defaultConfig: { title: "Webinar registered", eventType: "webinar_registered" } },

  // --- Conditions ---
  { key: "condition:yesno", type: "condition", group: "Conditions", label: "Yes / No condition", description: "Split the path on a live true/false check.", icon: "GitBranch", available: true, defaultConfig: { title: "Condition", check: "has_logged_in" } },

  // --- Timing ---
  { key: "wait", type: "wait", group: "Timing", label: "Wait", description: "Pause before the next step.", icon: "Timer", available: true, defaultConfig: { title: "Wait", durationValue: 1, durationUnit: "days" } },

  // --- Communications ---
  { key: "send_sms", type: "send_sms", group: "Communications", label: "Send SMS", description: "Send an approved DLT template (config only).", icon: "MessageSquare", available: true, defaultConfig: { title: "Send SMS", automationTemplateId: null, category: "transactional", quietHours: { start: "21:00", end: "08:00" }, frequencyCap: { perDays: 1, max: 1 }, variableMapping: {} } },

  // --- Staff Tasks ---
  { key: "staff_task", type: "staff_task", group: "Staff Tasks", label: "Staff task", description: "Create a task for the team to action.", icon: "ClipboardList", available: true, defaultConfig: { title: "Staff task", assignee: "", details: "" } },

  // --- Logic ---
  { key: "branch", type: "branch", group: "Logic", label: "Split test (A/B)", description: "Deterministically split contacts across labelled paths by weight.", icon: "Split", available: true, defaultConfig: { title: "Split test", branches: [{ label: "A", weight: 1 }, { label: "B", weight: 1 }] } },

  // --- Goals ---
  { key: "goal", type: "goal", group: "Goals", label: "Goal", description: "The outcome this journey optimizes for.", icon: "Target", available: true, defaultConfig: { title: "Goal", goalType: "logged_in" } },

  // --- Exit ---
  { key: "exit", type: "exit", group: "Exit", label: "Stop / Exit", description: "End the journey for this student.", icon: "OctagonMinus", available: true, defaultConfig: { title: "Exit" } },

  // --- Annotations (non-executable; documentation only) ---
  { key: "note", type: "note", group: "Annotations", label: "Note", description: "A sticky note to document the journey. Not executed.", icon: "StickyNote", available: true, defaultConfig: { title: "Note", text: "Describe this part of the journey…" } },
];

export const NODE_GROUPS: NodeGroup[] = [
  "Triggers", "Conditions", "Timing", "Communications", "Staff Tasks", "Logic", "Goals", "Exit", "Annotations",
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
  note: "var(--gold)",
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
  note: "StickyNote",
};
