export interface AdminNavItem {
  href: string;
  label: string;
  icon: string;
  group: string;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "📊", group: "Overview" },
  { href: "/admin/home", label: "Home Page", icon: "🏠", group: "Overview" },
  { href: "/admin/toppers", label: "Toppers / Results", icon: "🏅", group: "Website" },
  { href: "/admin/navigation", label: "Navigation / Header", icon: "🧭", group: "Website" },
  { href: "/admin/about", label: "About Page", icon: "📖", group: "Website" },
  { href: "/admin/leads", label: "Lead CRM", icon: "🎯", group: "Sales" },
  { href: "/admin/forms", label: "Lead Forms", icon: "📋", group: "Sales" },
  { href: "/admin/registrations", label: "Landing Pages", icon: "🚀", group: "Sales" },
  { href: "/admin/marketing", label: "Marketing", icon: "📣", group: "Sales" },
  { href: "/admin/referrals", label: "Referrals", icon: "🎁", group: "Sales" },
  { href: "/admin/courses", label: "Courses", icon: "🎓", group: "Academics" },
  { href: "/admin/webinars", label: "Webinars & Events", icon: "🎥", group: "Academics" },
  { href: "/admin/content", label: "Content / LMS", icon: "📚", group: "Academics" },
  { href: "/admin/plans", label: "Subscription Plans", icon: "💎", group: "Academics" },
  { href: "/admin/questions", label: "Question Bank", icon: "❓", group: "Assessments" },
  { href: "/admin/quizzes", label: "Quizzes / Tests", icon: "📝", group: "Assessments" },
  { href: "/admin/quiz-reports", label: "Attempts & Reports", icon: "📈", group: "Assessments" },
  { href: "/admin/quiz-imports", label: "Question Imports", icon: "🗂️", group: "Assessments" },
  { href: "/admin/students", label: "Students & Enrollments", icon: "👨‍🎓", group: "People" },
  { href: "/admin/payments", label: "Payments & Finance", icon: "💰", group: "People" },
  { href: "/admin/staff", label: "Staff & Roles", icon: "🧑‍💼", group: "People" },
  { href: "/admin/settings", label: "Settings", icon: "⚙️", group: "People" },
];
