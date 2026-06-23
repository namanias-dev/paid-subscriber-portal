import type { PermissionKey } from "@/lib/permissions";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: string;
  group: string;
  /** If set, the item is shown only to admins holding this permission. */
  perm?: PermissionKey;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "📊", group: "Overview" },
  { href: "/admin/home", label: "Home Page", icon: "🏠", group: "Overview", perm: "manage_settings" },
  { href: "/admin/toppers", label: "Toppers / Results", icon: "🏅", group: "Website", perm: "manage_settings" },
  { href: "/admin/navigation", label: "Navigation / Header", icon: "🧭", group: "Website", perm: "manage_settings" },
  { href: "/admin/about", label: "About Page", icon: "📖", group: "Website", perm: "manage_settings" },
  { href: "/admin/leads", label: "Lead CRM", icon: "🎯", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/forms", label: "Lead Forms", icon: "📋", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/registrations", label: "Landing Pages", icon: "🚀", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/marketing", label: "Marketing", icon: "📣", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/referrals", label: "Referrals", icon: "🎁", group: "Sales", perm: "manage_students_leads" },
  { href: "/admin/courses", label: "Courses", icon: "🎓", group: "Academics", perm: "content_courses" },
  { href: "/admin/library", label: "Brochure Library", icon: "🗂️", group: "Academics", perm: "content_pdfs_media" },
  { href: "/admin/webinars", label: "Webinars & Events", icon: "🎥", group: "Academics", perm: "content_webinars" },
  { href: "/admin/content", label: "Content / LMS", icon: "📚", group: "Academics", perm: "content_courses" },
  { href: "/admin/plans", label: "Subscription Plans", icon: "💎", group: "Academics", perm: "manage_pricing" },
  { href: "/admin/current-affairs", label: "CA Articles", icon: "📰", group: "Current Affairs", perm: "content_current_affairs" },
  { href: "/admin/current-affairs/pdfs", label: "PDF Library", icon: "📄", group: "Current Affairs", perm: "content_current_affairs" },
  { href: "/admin/current-affairs/analytics", label: "CA Analytics", icon: "📈", group: "Current Affairs", perm: "content_current_affairs" },
  { href: "/admin/questions", label: "Question Bank", icon: "❓", group: "Assessments", perm: "content_quizzes" },
  { href: "/admin/quizzes", label: "Quizzes / Tests", icon: "📝", group: "Assessments", perm: "content_quizzes" },
  { href: "/admin/quiz-reports", label: "Attempts & Reports", icon: "📈", group: "Assessments", perm: "content_quizzes" },
  { href: "/admin/quiz-imports", label: "Question Imports", icon: "🗂️", group: "Assessments", perm: "content_quizzes" },
  { href: "/admin/students", label: "Students & Enrollments", icon: "👨‍🎓", group: "People", perm: "manage_students_leads" },
  { href: "/admin/payments", label: "Payments & Finance", icon: "💰", group: "People", perm: "view_revenue" },
  { href: "/admin/course-payments", label: "Course EMI & Seats", icon: "🪑", group: "People", perm: "view_revenue" },
  { href: "/admin/staff", label: "Staff & Roles", icon: "🧑‍💼", group: "People", perm: "manage_staff" },
  { href: "/admin/settings", label: "Settings", icon: "⚙️", group: "People", perm: "manage_settings" },
];
