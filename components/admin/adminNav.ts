import type { PermissionKey } from "@/lib/permissions";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: string;
  group: string;
  /** If set, the item is shown only to admins holding this permission. */
  perm?: PermissionKey;
  /**
   * Extra route prefixes this item "owns" for active-state highlighting, so a
   * child/consolidated route lights up its true parent in the sidebar (e.g. the
   * At-Risk parent owns both risk sub-routes). Longest matching prefix wins, so
   * a more specific sibling (e.g. `/admin/course-payments/at-risk`) is never
   * stolen by a shorter parent (`/admin/course-payments`). Navigation only.
   */
  match?: string[];
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard", group: "Overview" },
  // No `perm` → visible to every logged-in staff member (the in-portal help center).
  { href: "/admin/learning", label: "Learning", icon: "learning", group: "Overview" },
  { href: "/admin/analytics", label: "Business Analytics", icon: "analytics", group: "Overview", perm: "view_revenue" },
  { href: "/admin/home", label: "Home Page", icon: "home", group: "Overview", perm: "manage_settings" },
  { href: "/admin/announcements", label: "Announcements", icon: "sparkle", group: "Website", perm: "manage_settings" },
  { href: "/admin/toppers", label: "Toppers / Results", icon: "toppers", group: "Website", perm: "manage_settings" },
  { href: "/admin/navigation", label: "Navigation / Header", icon: "navigation", group: "Website", perm: "manage_settings" },
  { href: "/admin/about", label: "About Page", icon: "about", group: "Website", perm: "manage_settings" },
  { href: "/admin/leads", label: "Lead CRM", icon: "leads", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/forms", label: "Lead Forms", icon: "forms", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/registrations", label: "Landing Pages", icon: "landing", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/marketing", label: "Marketing", icon: "marketing", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/referrals", label: "Referrals", icon: "referrals", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/careers", label: "Careers", icon: "careers", group: "Sales", perm: "manage_careers" },
  { href: "/admin/ai-agent", label: "AI Counsellor", icon: "ai_agent", group: "Sales", perm: "manage_ai_agent" },
  // ── COMMUNICATIONS ─────────────────────────────────────────────────────
  // Mission Control keeps its exact route, permission and behavior — only its
  // nav group label moves here so it sits alongside Journey Automation. Journey
  // Automation is gated by its OWN restrictive permission (NOT send_sms).
  { href: "/admin/communications/sms", label: "SMS Mission Control", icon: "sms", group: "Communications", perm: "send_sms" },
  { href: "/admin/communications/journey-automation", label: "Journey Automation", icon: "journey_automation", group: "Communications", perm: "journey_view" },
  { href: "/admin/courses", label: "Courses", icon: "courses", group: "Academics", perm: "content_courses" },
  { href: "/admin/library", label: "Brochure Library", icon: "brochures", group: "Academics", perm: "content_pdfs_media" },
  { href: "/admin/webinars", label: "Webinars & Events", icon: "webinars", group: "Academics", perm: "content_webinars" },
  { href: "/admin/content", label: "Content / LMS", icon: "content", group: "Academics", perm: "content_courses" },
  { href: "/admin/resources", label: "UPSC Resources", icon: "resources", group: "Academics", perm: "content_resources" },
  { href: "/admin/lecture-comments", label: "Lecture Q&A", icon: "qa", group: "Academics", perm: "content_courses" },
  { href: "/admin/plans", label: "Subscription Plans", icon: "plans", group: "Academics", perm: "manage_pricing" },
  { href: "/admin/current-affairs", label: "CA Articles", icon: "current_affairs", group: "Current Affairs", perm: "content_current_affairs" },
  { href: "/admin/current-affairs/pdfs", label: "PDF Library", icon: "pdf_library", group: "Current Affairs", perm: "content_current_affairs" },
  { href: "/admin/current-affairs/analytics", label: "CA Analytics", icon: "analytics", group: "Current Affairs", perm: "content_current_affairs" },
  { href: "/admin/questions", label: "Question Bank", icon: "question_bank", group: "Assessments", perm: "content_quizzes" },
  { href: "/admin/quizzes", label: "Quizzes / Tests", icon: "quiz_tests", group: "Assessments", perm: "content_quizzes" },
  { href: "/admin/quiz-reports", label: "Attempts & Reports", icon: "reports", group: "Assessments", perm: "content_quizzes" },
  { href: "/admin/quiz-imports", label: "Question Imports", icon: "imports", group: "Assessments", perm: "content_quizzes" },
  { href: "/admin/leaderboard", label: "Performance Leaderboard", icon: "leaderboard", group: "Assessments", perm: "manage_students_leads" },
  // ── ADMISSIONS & PAYMENTS ──────────────────────────────────────────────
  // The cohort-fees → student → collections → ledger lifecycle. Fees & EMI
  // leads (finance-first). Duplicate Enrollments folds into Students &
  // Enrollments (Duplicate Enrollments tab); the two risk worklists fold into
  // "At-Risk Students" (Payment Risk / Access Risk tabs). Old routes stay live;
  // `match` keeps child routes highlighting here.
  { href: "/admin/course-payments", label: "Fees & EMI", icon: "seats", group: "Admissions & Payments", perm: "view_revenue" },
  {
    href: "/admin/students",
    label: "Students & Enrollments",
    icon: "students",
    group: "Admissions & Payments",
    perm: "manage_students_leads",
    match: ["/admin/enrollments"],
  },
  {
    href: "/admin/at-risk",
    label: "At-Risk Students",
    icon: "at_risk",
    group: "Admissions & Payments",
    perm: "view_revenue",
    match: ["/admin/course-payments/at-risk", "/admin/access-risk"],
  },
  { href: "/admin/payments", label: "Payments", icon: "payments", group: "Admissions & Payments", perm: "view_revenue" },

  // ── TEAM & SYSTEM ──────────────────────────────────────────────────────
  { href: "/admin/staff", label: "Staff & Roles", icon: "staff", group: "Team & System", perm: "manage_staff" },
  { href: "/admin/settings", label: "Settings", icon: "settings", group: "Team & System", perm: "manage_settings" },
];
