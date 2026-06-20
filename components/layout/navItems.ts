export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const STUDENT_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/dashboard/my-courses", label: "My Courses", icon: "🎓" },
  { href: "/dashboard/library", label: "Daily Feed", icon: "📰" },
  { href: "/dashboard/live", label: "Live Classes", icon: "🔴" },
  { href: "/dashboard/tests", label: "Test Series", icon: "🧪" },
  { href: "/dashboard/material", label: "Study Material", icon: "📚" },
  { href: "/dashboard/mentorship", label: "Mentorship", icon: "🤝" },
  { href: "/dashboard/bookmarks", label: "Bookmarks", icon: "⭐" },
  { href: "/dashboard/fees", label: "My Fees", icon: "💳" },
  { href: "/dashboard/profile", label: "Profile", icon: "👤" },
];

export const STUDENT_BOTTOM_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/dashboard/my-courses", label: "Courses", icon: "🎓" },
  { href: "/dashboard/material", label: "Material", icon: "📚" },
  { href: "/dashboard/live", label: "Live", icon: "🔴" },
  { href: "/dashboard/profile", label: "Profile", icon: "👤" },
];
