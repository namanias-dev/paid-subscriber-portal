// Single source of truth for the in-app Help & Learn panel.
//
// Each topic maps to a markdown file in docs/staff/<slug>.md. The `match`
// patterns decide which guide is shown for the current admin route. Order here
// is the order shown in the panel's topic list (table of contents).
//
// The markdown content itself lives ONLY in docs/staff/*.md (no duplication) —
// this file just provides titles, grouping, and route detection.

export interface HelpTopic {
  slug: string;
  title: string;
  group: string;
  /** Route prefixes (under /admin) that should open this guide. */
  match: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  { slug: "getting-started", title: "Getting Started", group: "Start here", match: [] },
  { slug: "admin-handbook", title: "Admin Handbook (Index)", group: "Start here", match: [] },

  { slug: "dashboard", title: "Dashboard", group: "Overview", match: ["/admin"] },
  { slug: "analytics", title: "Business Analytics", group: "Overview", match: ["/admin/analytics"] },

  { slug: "leads", title: "Lead CRM", group: "Sales", match: ["/admin/leads"] },
  { slug: "sms", title: "SMS Mission Control", group: "Sales", match: ["/admin/communications/sms", "/admin/communications"] },
  { slug: "marketing-tools", title: "Marketing Tools", group: "Sales", match: ["/admin/marketing", "/admin/registrations", "/admin/forms", "/admin/referrals"] },

  { slug: "payments", title: "Payments & Finance", group: "People & Money", match: ["/admin/payments", "/admin/course-payments", "/admin/access-risk"] },
  { slug: "duplicate-enrollments", title: "Duplicate Enrollments (Merge tool)", group: "People & Money", match: ["/admin/enrollments/duplicates", "/admin/enrollments"] },
  { slug: "students", title: "Students & Enrollments", group: "People & Money", match: ["/admin/students"] },
  { slug: "payment-plans", title: "Changing a Student's Payment Plan", group: "People & Money", match: [] },
  { slug: "course-access", title: "Course & Portal Access", group: "People & Money", match: [] },
  { slug: "staff", title: "Staff & Roles", group: "People & Money", match: ["/admin/staff"] },
  { slug: "roles-permissions", title: "Roles & Permissions", group: "People & Money", match: [] },

  { slug: "webinars", title: "Webinars & Events", group: "Academics", match: ["/admin/webinars"] },
  { slug: "content-lms", title: "Content / LMS & Courses", group: "Academics", match: ["/admin/content", "/admin/courses", "/admin/library", "/admin/plans"] },
  { slug: "current-affairs", title: "Current Affairs", group: "Academics", match: ["/admin/current-affairs"] },
  { slug: "assessments", title: "Assessments", group: "Academics", match: ["/admin/questions", "/admin/quizzes", "/admin/quiz-reports", "/admin/quiz-imports"] },

  { slug: "website-settings", title: "Website & Settings", group: "Website", match: ["/admin/home", "/admin/toppers", "/admin/navigation", "/admin/about", "/admin/settings"] },

  { slug: "faq", title: "Common Tasks / FAQ", group: "Help", match: [] },
  { slug: "troubleshooting", title: "Troubleshooting", group: "Help", match: [] },
];

export const HELP_SLUGS: string[] = HELP_TOPICS.map((t) => t.slug);

/** Pick the best guide slug for an admin pathname (longest matching prefix). */
export function topicSlugForPath(pathname: string | null | undefined): string {
  if (!pathname) return "getting-started";
  let best: { slug: string; len: number } | null = null;
  for (const topic of HELP_TOPICS) {
    for (const m of topic.match) {
      const isMatch = m === "/admin" ? pathname === "/admin" : pathname === m || pathname.startsWith(m + "/") || pathname === m;
      if (isMatch && (!best || m.length > best.len)) best = { slug: topic.slug, len: m.length };
    }
  }
  return best?.slug ?? "getting-started";
}
