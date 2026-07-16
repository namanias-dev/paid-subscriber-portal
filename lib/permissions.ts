/**
 * Role-Based Access Control (RBAC) for the admin portal.
 *
 * A permission is a single boolean capability. A role bundles permissions and a
 * plain-English description. An admin account points at a role and may carry an
 * optional per-account override (sparse object) that wins over the role.
 *
 * Everything here is pure/serialisable so it can live inside the admin JWT and
 * be enforced both in the UI (hide) and on the server (reject).
 */

export type PermissionKey =
  | "manage_staff"
  | "manage_roles"
  | "view_revenue"
  | "manage_payments"
  | "manage_pricing"
  | "manage_settings"
  | "content_courses"
  | "content_webinars"
  | "content_quizzes"
  | "content_current_affairs"
  | "content_resources"
  | "content_pdfs_media"
  | "manage_seo"
  | "publish_content"
  | "manage_students_leads"
  | "view_analytics_nonrevenue"
  | "view_analytics_revenue"
  | "manage_integrations"
  | "send_sms"
  // OPERATIONAL SMS Mission Control management (create/edit/delete templates, edit
  // message variables/content). Distinct from `send_sms` (send approved templates +
  // view logs) and from the PROTECTED send-safety controls (SMS-enabled flag, kill
  // switch, bulk send) which stay Super Admin only. Holding this NEVER enables
  // sending — it only unlocks day-to-day content management.
  | "manage_sms"
  | "manage_careers"
  | "manage_ai_agent"
  // Journey Automation (Communications). NEW + restrictive by default — holding
  // send_sms (SMS Mission Control) grants NONE of these. Publishing and the kill
  // switch are the most sensitive. Only Super Admin holds them until explicitly
  // granted via the roles UI.
  | "journey_view"
  | "journey_create_draft"
  | "journey_edit_draft"
  | "journey_publish"
  | "journey_pause"
  | "journey_manage_templates"
  | "journey_manage_execution"
  | "journey_manage_killswitch";

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  group: string;
  /** Financial/revenue-sensitive capability — never granted to non-finance roles. */
  financial?: boolean;
}

export const PERMISSIONS: PermissionMeta[] = [
  { key: "manage_staff", label: "Manage staff accounts", group: "Administration" },
  { key: "manage_roles", label: "Manage roles & permissions", group: "Administration" },
  { key: "manage_settings", label: "Manage settings & website config", group: "Administration" },
  { key: "manage_integrations", label: "Manage integrations & API keys", group: "Administration" },

  { key: "view_revenue", label: "View revenue dashboards", group: "Finance", financial: true },
  { key: "manage_payments", label: "Manage payments, invoices & payouts", group: "Finance", financial: true },
  { key: "manage_pricing", label: "Edit pricing & subscription plans", group: "Finance", financial: true },
  { key: "view_analytics_revenue", label: "View revenue analytics", group: "Finance", financial: true },

  { key: "content_courses", label: "Manage course content", group: "Content" },
  { key: "content_webinars", label: "Manage webinars & events", group: "Content" },
  { key: "content_quizzes", label: "Manage quizzes & question bank", group: "Content" },
  { key: "content_current_affairs", label: "Manage Current Affairs", group: "Content" },
  { key: "content_resources", label: "Manage UPSC Resources (SEO hub)", group: "Content" },
  { key: "content_pdfs_media", label: "Manage PDFs & media", group: "Content" },
  { key: "manage_seo", label: "Manage SEO & metadata", group: "Content" },
  { key: "publish_content", label: "Publish / unpublish content", group: "Content" },

  { key: "manage_students_leads", label: "Manage students, leads & enrollments", group: "Operations" },
  { key: "view_analytics_nonrevenue", label: "View non-revenue analytics", group: "Operations" },
  { key: "send_sms", label: "Send SMS (Approved templates) & view SMS logs", group: "Operations" },
  { key: "manage_sms", label: "Manage SMS Mission Control (templates, variables & content)", group: "Operations" },
  { key: "manage_careers", label: "Manage careers & job applications", group: "Operations" },
  { key: "manage_ai_agent", label: "Manage AI Counselor Agent (leads, conversations & settings)", group: "Operations" },

  // Journey Automation — granular + restrictive. NOT implied by send_sms.
  { key: "journey_view", label: "View Journey Automation workflows", group: "Communications" },
  { key: "journey_create_draft", label: "Create Journey Automation drafts", group: "Communications" },
  { key: "journey_edit_draft", label: "Edit Journey Automation drafts", group: "Communications" },
  { key: "journey_publish", label: "Publish Journey Automation versions", group: "Communications" },
  { key: "journey_pause", label: "Pause / resume Journey Automation workflows", group: "Communications" },
  { key: "journey_manage_templates", label: "Manage Journey Automation templates", group: "Communications" },
  { key: "journey_manage_execution", label: "Enable Journey Automation execution (simulate/live/canary)", group: "Communications" },
  { key: "journey_manage_killswitch", label: "Manage Journey Automation kill switch", group: "Communications" },
];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

export type PermissionSet = Partial<Record<PermissionKey, boolean>>;

/** All permissions on. */
export function allPermissions(): PermissionSet {
  const out: PermissionSet = {};
  for (const k of PERMISSION_KEYS) out[k] = true;
  return out;
}

function only(keys: PermissionKey[]): PermissionSet {
  const out: PermissionSet = {};
  for (const k of keys) out[k] = true;
  return out;
}

const CONTENT_KEYS: PermissionKey[] = [
  "content_courses",
  "content_webinars",
  "content_quizzes",
  "content_current_affairs",
  "content_resources",
  "content_pdfs_media",
  "manage_seo",
  "publish_content",
];

export interface RoleSeed {
  id: string;
  name: string;
  description: string;
  permissions: PermissionSet;
  can: string[];
  cannot: string[];
  /** System roles cannot be deleted (but custom ones can). */
  is_system: boolean;
  /** Tailwind-ish badge tone for the UI. */
  badge: "navy" | "gold" | "green" | "blue" | "gray" | "amber" | "red";
}

export const DEFAULT_ROLES: RoleSeed[] = [
  {
    id: "super_admin",
    name: "Super Admin",
    description: "Full, unrestricted access to everything including staff, roles, revenue and settings.",
    permissions: allPermissions(),
    can: ["Everything — content, revenue, settings", "Create & manage staff and roles", "Delete data and configure the org"],
    cannot: ["Be deleted (at least one must always exist)"],
    is_system: true,
    badge: "gold",
  },
  {
    id: "admin",
    name: "Admin",
    description: "Full operational access including revenue, but cannot manage Super Admins or critical org settings.",
    permissions: { ...allPermissions(), manage_roles: false },
    can: ["Full content & publishing", "View revenue & manage payments", "Manage staff (below Super Admin)"],
    cannot: ["Manage Super Admins", "Edit roles & permission matrix"],
    is_system: true,
    badge: "navy",
  },
  {
    id: "content_admin",
    name: "Content Admin",
    description: "Full access to ALL content and general settings — but NO revenue or financial data.",
    permissions: {
      ...only(CONTENT_KEYS),
      manage_settings: true,
      manage_students_leads: true,
      view_analytics_nonrevenue: true,
      send_sms: true,
      manage_careers: true,
    },
    can: ["Full content (Courses, Webinars, Quizzes, Current Affairs, PDFs)", "SEO, publishing & settings", "Students, leads & non-revenue analytics"],
    cannot: ["View revenue or payments", "Edit pricing/plans", "Manage staff or roles"],
    is_system: true,
    badge: "blue",
  },
  {
    id: "content_editor",
    name: "Content Editor",
    description: "Create, edit and publish content only. No settings, staff or revenue.",
    permissions: { ...only(CONTENT_KEYS) },
    can: ["Create & edit all content", "Publish / unpublish", "Manage SEO"],
    cannot: ["Access revenue or payments", "Manage settings, staff or roles"],
    is_system: true,
    badge: "green",
  },
  {
    id: "current_affairs_editor",
    name: "Current Affairs Editor",
    description: "Only the Current Affairs module — articles, daily/monthly, PDFs, CA categories & tags.",
    permissions: { content_current_affairs: true, content_pdfs_media: true, publish_content: true, view_analytics_nonrevenue: true },
    can: ["Manage Current Affairs articles", "Upload daily/monthly PDFs", "Publish CA content"],
    cannot: ["Touch other content modules", "Access revenue, settings, staff"],
    is_system: true,
    badge: "amber",
  },
  {
    id: "support_ops",
    name: "Support / Operations",
    description: "View and respond to students & leads, manage enrollments. No publishing, revenue or staff.",
    permissions: { manage_students_leads: true, view_analytics_nonrevenue: true, send_sms: true, manage_careers: true },
    can: ["View students & leads", "Respond & manage enrollments", "View non-revenue analytics"],
    cannot: ["Publish content", "Access revenue", "Manage staff"],
    is_system: true,
    badge: "blue",
  },
  {
    id: "finance",
    name: "Finance / Revenue",
    description: "Revenue dashboards, payments, payouts and invoices only. No content, staff or settings.",
    permissions: { view_revenue: true, manage_payments: true, manage_pricing: true, view_analytics_revenue: true, view_analytics_nonrevenue: true },
    can: ["View revenue dashboards", "Manage payments, invoices & payouts", "Edit pricing & plans"],
    cannot: ["Edit content", "Manage staff, roles or settings"],
    is_system: true,
    badge: "red",
  },
  {
    id: "viewer",
    name: "Viewer / Analyst",
    description: "Read-only across allowed modules. No edits and no revenue unless explicitly granted.",
    permissions: { view_analytics_nonrevenue: true },
    can: ["Read-only access to allowed modules", "View non-revenue analytics"],
    cannot: ["Make any edits", "View revenue", "Manage staff or settings"],
    is_system: true,
    badge: "gray",
  },
];

export function getRoleSeed(id: string): RoleSeed | undefined {
  return DEFAULT_ROLES.find((r) => r.id === id);
}

/** Resolve effective permissions = role permissions overlaid by per-account override. */
export function resolvePermissions(rolePerms: PermissionSet | null | undefined, override?: PermissionSet | null): PermissionSet {
  const base: PermissionSet = { ...(rolePerms || {}) };
  if (override) {
    for (const [k, v] of Object.entries(override)) {
      if (v === true || v === false) base[k as PermissionKey] = v;
    }
  }
  return base;
}

export function hasPermission(perms: PermissionSet | null | undefined, key: PermissionKey): boolean {
  return !!perms && perms[key] === true;
}

export function isSuperAdmin(perms: PermissionSet | null | undefined): boolean {
  // Super Admin is the only role that can manage roles AND staff AND revenue.
  return hasPermission(perms, "manage_roles") && hasPermission(perms, "manage_staff") && hasPermission(perms, "view_revenue");
}

/**
 * Anti-escalation: an actor may only grant permissions they themselves hold.
 * Returns the list of permission keys the target would have that the actor lacks.
 */
export function escalatedKeys(actor: PermissionSet, target: PermissionSet): PermissionKey[] {
  return PERMISSION_KEYS.filter((k) => target[k] === true && actor[k] !== true);
}

export function canAssign(actor: PermissionSet, target: PermissionSet): boolean {
  return escalatedKeys(actor, target).length === 0;
}

/** Build a readable list of granted permission labels. */
export function grantedLabels(perms: PermissionSet): string[] {
  return PERMISSIONS.filter((p) => perms[p.key] === true).map((p) => p.label);
}
