import type { PlanInfo } from "./types";

/**
 * DEMO MODE is ON whenever Supabase is not configured.
 * The whole app runs on mock data + demo logins until real env vars are added.
 */
export const isDemoMode =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL.trim() === "";

export const RAZORPAY_ENABLED = !!process.env.RAZORPAY_KEY_ID;
export const EMAIL_ENABLED = !!process.env.RESEND_API_KEY;
// ICICI Eazypay is "live" once the backend AES key is configured.
export const EAZYPAY_ENABLED = !!process.env.ICICI_EAZYPAY_AES_KEY;

// ⚠️ Dev fallbacks are only safe in demo mode. Set strong secrets in production.
export const JWT_SECRET = process.env.JWT_SECRET || "demo-dev-secret-change-me";
export const ADMIN_JWT_SECRET =
  process.env.ADMIN_JWT_SECRET || "demo-admin-secret-change-me";

export const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL || "https://portal.example.com";

/**
 * Demo credentials are read from env with NON-SENSITIVE placeholder fallbacks.
 * These placeholders are intentionally generic test values — never real secrets.
 * The UI only shows a generic hint; the literal values live in .env.example / README.
 */
export const DEMO_STUDENT = {
  phone: process.env.DEMO_STUDENT_PHONE || "9999999999",
  code: process.env.DEMO_STUDENT_ACCESS_CODE || "NS-0000-DEMO",
};
export const DEMO_ADMIN = {
  username: process.env.DEMO_ADMIN_USERNAME || "demoadmin",
  password: process.env.DEMO_ADMIN_PASSWORD || "DemoAdmin2025",
};

export const SUPPORT = {
  phone: process.env.SUPPORT_PHONE || "0000000000",
  email: process.env.SUPPORT_EMAIL || "support@example.com",
};

/** Canonical site origin (no trailing slash) — used for SEO/OG absolute URLs. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://namanias.com").replace(/\/$/, "");

export const ACADEMY = {
  name: "Naman Sharma IAS Academy",
  shortName: "Naman IAS",
  tagline: "Chandigarh's Most Personal UPSC Preparation Community",
  address: "Sector 17C, Chandigarh",
  instagram: "https://instagram.com",
  youtube: "https://youtube.com",
  telegram: "https://telegram.org",
  citiesServed: ["Chandigarh", "Mohali", "Panchkula", "Zirakpur", "Punjab", "Haryana", "Himachal"],
  stats: {
    instagram: "388K+",
    youtube: "220K+",
    years: "9+",
    batchSize: "~40",
  },
};

export const STUDENT_COOKIE = "naman_student_token";
export const ADMIN_COOKIE = "naman_admin_token";
/** Buyer portal session (phone + login code), separate from the student subscription portal. */
export const BUYER_COOKIE = "naman_buyer_token";

export const PLANS: PlanInfo[] = [
  {
    id: "1m",
    name: "1 Month",
    durationLabel: "30 days access",
    months: 1,
    days: 30,
    price: 299,
    bullets: ["Daily Current Affairs", "Daily Prelims MCQs", "Subject Booklets", "PYQ Bank"],
    envKey: "NEXT_PUBLIC_RAZORPAY_LINK_1M",
  },
  {
    id: "3m",
    name: "3 Months",
    durationLabel: "90 days access",
    months: 3,
    days: 90,
    price: 799,
    badge: "MOST POPULAR",
    highlight: true,
    bullets: ["Everything in 1 Month", "Answer Writing reviews", "Live + Recordings", "Test Series access"],
    envKey: "NEXT_PUBLIC_RAZORPAY_LINK_3M",
  },
  {
    id: "6m",
    name: "6 Months",
    durationLabel: "180 days access",
    months: 6,
    days: 180,
    price: 1499,
    badge: "Best Value",
    bullets: ["Everything in 3 Months", "Full Prelims + Mains coverage", "Priority doubt support", "Optional material"],
    envKey: "NEXT_PUBLIC_RAZORPAY_LINK_6M",
  },
  {
    id: "12m",
    name: "12 Months",
    durationLabel: "365 days access",
    months: 12,
    days: 365,
    price: 2499,
    bullets: ["Everything in 6 Months", "Full-year mentorship", "All live cohorts", "Complete archive"],
    envKey: "NEXT_PUBLIC_RAZORPAY_LINK_12M",
  },
  {
    id: "lifetime",
    name: "Lifetime",
    durationLabel: "∞ Forever access",
    months: null,
    days: null,
    price: 3999,
    badge: "Gold",
    bullets: ["Everything, forever", "All future content", "Lifetime community", "Priority everything"],
    envKey: "NEXT_PUBLIC_RAZORPAY_LINK_LIFETIME",
  },
];

export function getPlan(id: string): PlanInfo | undefined {
  return PLANS.find((p) => p.id === id);
}

export function getRazorpayLink(planId: string): string | null {
  const plan = getPlan(planId);
  if (!plan) return null;
  const link = process.env[plan.envKey];
  return link && link.trim() !== "" ? link : null;
}

export const SUBJECTS = [
  "Polity",
  "Economy",
  "Geography",
  "History",
  "Environment",
  "S&T",
  "IR",
  "Ethics",
  "CSAT",
  "Optional",
];

export const COURSE_CATEGORIES = [
  "Foundation",
  "Optional",
  "Test Series",
  "Mains",
  "Specialist",
  "Mentorship",
  "Entry",
  "PCS",
];

export const LEARNING_MODES = ["Online", "Offline", "Hybrid", "Recorded"];
