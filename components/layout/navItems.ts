export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const STUDENT_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/dashboard/my-courses", label: "My Courses", icon: "courses" },
  { href: "/dashboard/library", label: "Daily Feed", icon: "feed" },
  { href: "/dashboard/live", label: "Live Classes", icon: "live" },
  { href: "/dashboard/tests", label: "Test Series", icon: "tests" },
  { href: "/dashboard/quizzes", label: "Quizzes & MCQs", icon: "quizzes" },
  { href: "/dashboard/material", label: "Study Material", icon: "material" },
  { href: "/dashboard/mentorship", label: "Mentorship", icon: "mentorship" },
  { href: "/dashboard/bookmarks", label: "Bookmarks", icon: "bookmarks" },
  { href: "/dashboard/fees", label: "My Fees", icon: "fees" },
  { href: "/dashboard/profile", label: "Profile", icon: "profile" },
];

export const STUDENT_BOTTOM_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/dashboard/my-courses", label: "Courses", icon: "courses" },
  { href: "/dashboard/material", label: "Material", icon: "material" },
  { href: "/dashboard/live", label: "Live", icon: "live" },
  { href: "/dashboard/profile", label: "Profile", icon: "profile" },
];
