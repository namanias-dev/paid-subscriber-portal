import type { PlanInfo } from "./types";

/**
 * DEMO MODE is ON whenever Supabase is not configured.
 * In demo mode the whole app runs on mock data and demo logins.
 * The moment NEXT_PUBLIC_SUPABASE_URL is set in Vercel, the app
 * automatically switches to LIVE mode — no code changes needed.
 */
export const isDemoMode =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL.trim() === "";

export const RAZORPAY_ENABLED = !!process.env.RAZORPAY_KEY_ID;
export const EMAIL_ENABLED = !!process.env.RESEND_API_KEY;

// ⚠️ These dev fallbacks are ONLY safe in demo mode.
// Always set strong, unique secrets in production (Vercel env vars).
export const JWT_SECRET =
  process.env.JWT_SECRET || "demo-dev-secret-change-me";
export const ADMIN_JWT_SECRET =
  process.env.ADMIN_JWT_SECRET || "demo-admin-secret-change-me";

export const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL || "https://portal.namaniasacademy.com";

export const ACADEMY = {
  name: "Naman Sharma IAS Academy",
  shortName: "Naman IAS",
  tagline: "India's Most Personal UPSC Preparation Community",
  phone: "8437686541",
  address: "Sector 17, Chandigarh",
  instagram: "https://instagram.com/namansharma_ias",
  youtube: "https://youtube.com/@namansharma_ias",
};

export const STUDENT_COOKIE = "naman_student_token";
export const ADMIN_COOKIE = "naman_admin_token";

export const DEMO_STUDENT = { phone: "9999999999", code: "NS-0000-DEMO" };
export const DEMO_ADMIN = { username: "namanadmin", password: "NamanAdmin2025" };

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
    bullets: [
      "Everything in 1 Month",
      "Answer Writing reviews",
      "Live + Recordings",
      "Test Series access",
    ],
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
    bullets: [
      "Everything in 3 Months",
      "Full Prelims + Mains coverage",
      "Priority doubt support",
      "Optional subject material",
    ],
    envKey: "NEXT_PUBLIC_RAZORPAY_LINK_6M",
  },
  {
    id: "12m",
    name: "12 Months",
    durationLabel: "365 days access",
    months: 12,
    days: 365,
    price: 2499,
    bullets: [
      "Everything in 6 Months",
      "Full-year mentorship",
      "All live cohorts",
      "Complete archive access",
    ],
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
    bullets: [
      "Everything, forever",
      "All future content",
      "Lifetime community access",
      "Priority everything",
    ],
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
