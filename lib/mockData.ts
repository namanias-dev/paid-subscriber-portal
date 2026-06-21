import { DEMO_ADMIN } from "./config";
import type {
  Student,
  ContentItem,
  Bookmark,
  ContentProgress,
  AdminUser,
  Course,
  Enrollment,
  Lead,
  LeadActivity,
  LeadFormConfig,
  Webinar,
  Payment,
  Referral,
  Staff,
  Question,
  Quiz,
  QuizQuestion,
  QuizAttempt,
  QuizAnswer,
  ImportJob,
} from "./types";

const DAY = 86400000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// =================================================================
// STUDENTS
// =================================================================
export const students: Student[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Demo Student",
    phone: "9999999999",
    email: "demo@example.com",
    plan: "3m",
    months: 3,
    access_code: "NS-0000-DEMO",
    start_date: iso(now - 20 * DAY),
    expiry_date: iso(now + 70 * DAY),
    amount_paid: 799,
    razorpay_payment_id: "pay_demo0001",
    razorpay_order_id: "order_demo0001",
    target_year: 2026,
    optional_subject: "Sociology",
    streak_count: 5,
    last_active_date: isoDate(now - DAY),
    is_active: true,
    created_at: iso(now - 20 * DAY),
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Test Aarav",
    phone: "9810011001",
    email: "aarav@example.com",
    plan: "12m",
    months: 12,
    access_code: "NS-4821-AARA",
    start_date: iso(now - 40 * DAY),
    expiry_date: iso(now + 325 * DAY),
    amount_paid: 2499,
    razorpay_payment_id: "pay_demo0002",
    razorpay_order_id: "order_demo0002",
    target_year: 2026,
    optional_subject: "PSIR",
    streak_count: 12,
    last_active_date: isoDate(now - DAY),
    is_active: true,
    created_at: iso(now - 40 * DAY),
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Test Ishita",
    phone: "9820022002",
    email: "ishita@example.com",
    plan: "1m",
    months: 1,
    access_code: "NS-7390-ISHI",
    start_date: iso(now - 26 * DAY),
    expiry_date: iso(now + 4 * DAY),
    amount_paid: 299,
    razorpay_payment_id: "pay_demo0003",
    razorpay_order_id: "order_demo0003",
    target_year: 2027,
    optional_subject: "Geography",
    streak_count: 3,
    last_active_date: isoDate(now - 2 * DAY),
    is_active: true,
    created_at: iso(now - 26 * DAY),
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    name: "Test Rohan",
    phone: "9830033003",
    email: "rohan@example.com",
    plan: "1m",
    months: 1,
    access_code: "NS-1567-ROHA",
    start_date: iso(now - 40 * DAY),
    expiry_date: iso(now - 10 * DAY),
    amount_paid: 299,
    razorpay_payment_id: "pay_demo0004",
    razorpay_order_id: "order_demo0004",
    target_year: 2026,
    optional_subject: "Sociology",
    streak_count: 0,
    last_active_date: isoDate(now - 11 * DAY),
    is_active: true,
    created_at: iso(now - 40 * DAY),
  },
  {
    id: "55555555-5555-5555-5555-555555555555",
    name: "Test Sneha",
    phone: "9840044004",
    email: "sneha@example.com",
    plan: "lifetime",
    months: null,
    access_code: "NS-9043-SNEH",
    start_date: iso(now - 120 * DAY),
    expiry_date: null,
    amount_paid: 3999,
    razorpay_payment_id: "pay_demo0005",
    razorpay_order_id: "order_demo0005",
    target_year: 2026,
    optional_subject: "Anthropology",
    streak_count: 28,
    last_active_date: isoDate(now - DAY),
    is_active: true,
    created_at: iso(now - 120 * DAY),
  },
];

// =================================================================
// COURSES (full catalogue)
// =================================================================
function course(p: Partial<Course> & Pick<Course, "id" | "slug" | "title" | "category" | "price">): Course {
  return {
    long_description: null,
    image: null,
    description: p.description ?? p.title,
    modes: ["Online"],
    language: "Hinglish (Bilingual)",
    target_years: "2026/27/28",
    batch_start: null,
    duration: "12 months",
    original_price: null,
    gst: false,
    emi_amount: null,
    emi_months: null,
    faculty: "Naman Sir",
    capacity: null,
    seats_left: null,
    status: "published",
    brochure_link: "https://drive.google.com/file/d/PLACEHOLDER_BROCHURE/view",
    demo_video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    razorpay_link: null,
    included: [
      "Complete recorded + live lectures",
      "Class notes & handouts (PDF)",
      "Doubt support",
      "Access on mobile & web",
    ],
    not_included: ["Printed material (shipping extra)", "Personal 1:1 mentorship (unless specified)"],
    curriculum: [
      { title: "Orientation & Strategy", lectures: [{ title: "How to start UPSC", duration: "45m" }] },
      { title: "Core GS", lectures: [{ title: "Polity Basics", duration: "1h" }, { title: "Economy Basics", duration: "1h" }] },
    ],
    schedule: "Mon–Sat, 7:00–9:00 AM IST",
    featured: false,
    created_at: iso(now - 30 * DAY),
    ...p,
  };
}

export const courses: Course[] = [
  course({ id: "co-safalta", slug: "safalta-online-foundation", title: "Safalta Online Foundation 2027/28/29", category: "Foundation", modes: ["Online"], price: 40000, original_price: 50000, emi_amount: 4000, emi_months: 10, featured: true, target_years: "2027/28/29", duration: "18 months", description: "Complete GS foundation for first-timers, fully online with live + recorded support." }),
  course({ id: "co-saarthi-off", slug: "saarthi-gs-foundation-offline", title: "Saarthi GS Foundation (Offline Chandigarh)", category: "Foundation", modes: ["Offline"], price: 75000, featured: true, description: "Flagship classroom foundation program at our Chandigarh Sector 17C centre.", faculty: "Naman Sir & Core Faculty", capacity: 40, seats_left: 8 }),
  course({ id: "co-saarthi-on", slug: "saarthi-gs-foundation-online", title: "Saarthi GS Foundation (Online)", category: "Foundation", modes: ["Online"], price: 40000, description: "The Saarthi foundation experience, delivered live online across India." }),
  course({ id: "co-digital-saarthi", slug: "digital-saarthi", title: "Digital Saarthi", category: "Foundation", modes: ["Online", "Recorded"], price: 40000, description: "Self-paced digital foundation with structured drip release." }),
  course({ id: "co-ncert", slug: "ncert-foundation", title: "NCERT Foundation", category: "Specialist", modes: ["Online", "Hybrid"], price: 7500, duration: "3 months", description: "Build rock-solid basics through complete NCERT coverage." }),
  course({ id: "co-pubad", slug: "public-administration-optional", title: "Public Administration Optional 2026", category: "Optional", modes: ["Offline", "Online"], price: 45000, target_years: "2026", description: "Comprehensive Pub Ad optional coverage with answer writing." }),
  course({ id: "co-psir", slug: "psir-optional", title: "PSIR Optional 2026", category: "Optional", modes: ["Online"], price: 40000, original_price: 60000, target_years: "2026", description: "Political Science & IR optional, full syllabus + test series." }),
  course({ id: "co-ethics", slug: "ethics-governance-mains", title: "Ethics & Governance (Mains 2026/27)", category: "Mains", modes: ["Online"], price: 10000, original_price: 20000, target_years: "2026/27", duration: "2 months", description: "GS4 Ethics mastery with case studies and model answers." }),
  course({ id: "co-mentorship", slug: "exclusive-mentorship-naman-sir", title: "Exclusive Mentorship by Naman Sir", category: "Mentorship", modes: ["Online"], price: 15000, original_price: 30000, featured: true, duration: "6 months", description: "Personal 1:1 mentorship, study plan, and weekly reviews with Naman Sir.", capacity: 25, seats_left: 5 }),
  course({ id: "co-mains-ts", slug: "upsc-mains-test-series-2026", title: "UPSC Mains Test Series 2026", category: "Test Series", modes: ["Online"], price: 12000, original_price: 15000, target_years: "2026", duration: "Full cycle", description: "Full-length GS + Essay mains tests with evaluation." }),
  course({ id: "co-pubad-ts", slug: "pubad-optional-test-series-2026", title: "Pub Ad Optional Test Series 2026", category: "Test Series", modes: ["Online"], price: 7000, original_price: 10000, target_years: "2026", description: "Sectional + full tests for Public Administration optional." }),
  course({ id: "co-maps", slug: "upsc-through-maps-prelims-2026", title: "UPSC Through Maps (Prelims 2026)", category: "Specialist", modes: ["Recorded"], price: 1000, original_price: 10000, target_years: "2026", duration: "Recorded", description: "Master geography & mapping for Prelims through visual learning." }),
  course({ id: "co-masterclass", slug: "beginner-upsc-masterclass", title: "Beginner UPSC Masterclass", category: "Entry", modes: ["Online"], price: 50, original_price: 500, duration: "2 hours", description: "₹50 beginner masterclass — the perfect first step into UPSC." }),
  course({ id: "co-demo", slug: "one-week-upsc-demo", title: "1-Week UPSC Demo", category: "Entry", modes: ["Online", "Offline"], price: 500, original_price: 1000, duration: "1 week", description: "Experience our teaching for a full week before you commit." }),
  course({ id: "co-pcs-ts", slug: "punjab-pcs-prelims-test-series", title: "Punjab PCS Prelims Test Series", category: "PCS", modes: ["Online", "Offline"], price: 2000, target_years: "2026", description: "Targeted Punjab PCS prelims practice with state-specific focus." }),
  course({ id: "co-pcs-weekend", slug: "punjab-pcs-weekend-batch", title: "Punjab PCS Weekend Batch", category: "PCS", modes: ["Offline"], price: 10000, description: "Weekend classroom batch for working aspirants — Punjab PCS." }),
  course({ id: "co-hcs", slug: "hcs-crash-course", title: "HCS Crash Course", category: "PCS", modes: ["Online", "Offline"], price: 10000, description: "Fast-track crash course for Haryana Civil Services." }),
  course({ id: "co-counselling", slug: "free-counselling", title: "Free Counselling", category: "Entry", modes: ["Online"], price: 0, duration: "30 min call", description: "Free one-on-one counselling to plan your UPSC journey." }),
];

// =================================================================
// CONTENT
// =================================================================
function ci(p: Partial<ContentItem> & Pick<ContentItem, "id" | "type" | "title">): ContentItem {
  return {
    subject: null,
    paper: null,
    description: null,
    drive_link: null,
    youtube_link: null,
    date: isoDate(now),
    duration: null,
    is_published: true,
    course_id: null,
    drip_date: null,
    created_at: iso(now),
    ...p,
  };
}

export const contentItems: ContentItem[] = [
  ci({ id: "c1111111-1111-1111-1111-111111111111", type: "current_affairs", subject: "Polity", paper: "GS2", title: "Daily Current Affairs — Today's Top 10", description: "Curated headlines, SC verdicts, economy & IR for today.", drive_link: "https://drive.google.com/file/d/PLACEHOLDER_CA/view", date: isoDate(now), duration: "12 min read" }),
  ci({ id: "c2222222-2222-2222-2222-222222222222", type: "mcq", subject: "Economy", paper: "GS3", title: "Daily Prelims MCQs — Set 142", description: "10 fresh prelims MCQs with explanations.", drive_link: "https://drive.google.com/file/d/PLACEHOLDER_MCQ/view", date: isoDate(now), duration: "10 questions" }),
  ci({ id: "c3333333-3333-3333-3333-333333333333", type: "booklet", subject: "Polity", paper: "GS2", title: "Fundamental Rights Booklet", description: "Articles 12-35 with mind-maps.", drive_link: "https://drive.google.com/file/d/PLACEHOLDER_FR/view", date: isoDate(now - 3 * DAY), duration: "48 pages" }),
  ci({ id: "c4444444-4444-4444-4444-444444444444", type: "recording", subject: "Geography", paper: "GS1", title: "Recording — Indian Monsoon Mechanism", description: "Full class recording with diagrams.", youtube_link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", date: isoDate(now - 5 * DAY), duration: "1h 24m", course_id: "co-saarthi-on" }),
  ci({ id: "c5555555-5555-5555-5555-555555555555", type: "live_link", subject: "Ethics", paper: "GS4", title: "Live — Ethics Case Studies Masterclass", description: "Join Naman Sir live for case-study frameworks.", youtube_link: "https://www.youtube.com/watch?v=live_placeholder", date: isoDate(now + DAY), duration: "8:00 PM IST", course_id: "co-ethics" }),
  ci({ id: "c6666666-6666-6666-6666-666666666666", type: "pyq", subject: "History", paper: "GS1", title: "PYQ Bank — Modern History (2013-2024)", description: "Topic-wise PYQs with trend analysis.", drive_link: "https://drive.google.com/file/d/PLACEHOLDER_PYQ/view", date: isoDate(now - 7 * DAY), duration: "60 pages" }),
  ci({ id: "c7777777-7777-7777-7777-777777777777", type: "test_series", subject: "Environment", paper: "GS3", title: "Prelims Full Test 04", description: "100-question full-length prelims test.", drive_link: "https://drive.google.com/file/d/PLACEHOLDER_FT04/view", date: isoDate(now + 2 * DAY), duration: "100 questions", is_published: false, course_id: "co-mains-ts" }),
  ci({ id: "c8888888-8888-8888-8888-888888888888", type: "answer_writing", subject: "Ethics", paper: "GS4", title: "Answer Writing — Daily Mains Question", description: "Today's mains question + model structure.", drive_link: "https://drive.google.com/file/d/PLACEHOLDER_AW/view", date: isoDate(now), duration: "1 question", is_published: false }),
  ci({ id: "c9999999-9999-9999-9999-999999999999", type: "maps", subject: "Geography", paper: "GS1", title: "UPSC Through Maps — Physical Geography Set", description: "Annotated map set for Prelims.", drive_link: "https://drive.google.com/file/d/PLACEHOLDER_MAPS/view", date: isoDate(now - 1 * DAY), duration: "20 maps", course_id: "co-maps" }),
  ci({ id: "ca000000-0000-0000-0000-000000000001", type: "notes", subject: "Economy", paper: "GS3", title: "Budget 2026 — Crisp Notes", description: "Quick-revision budget notes.", drive_link: "https://drive.google.com/file/d/PLACEHOLDER_BUDGET/view", date: isoDate(now - 2 * DAY), duration: "16 pages" }),
];

export const bookmarks: Bookmark[] = [
  { id: "b1111111-1111-1111-1111-111111111111", student_id: "11111111-1111-1111-1111-111111111111", content_id: "c3333333-3333-3333-3333-333333333333", created_at: iso(now - 2 * DAY) },
  { id: "b2222222-2222-2222-2222-222222222222", student_id: "11111111-1111-1111-1111-111111111111", content_id: "c6666666-6666-6666-6666-666666666666", created_at: iso(now - DAY) },
];

export const contentProgress: ContentProgress[] = [
  { id: "p1111111-1111-1111-1111-111111111111", student_id: "11111111-1111-1111-1111-111111111111", content_id: "c1111111-1111-1111-1111-111111111111", completed: true, completed_at: iso(now - DAY) },
  { id: "p2222222-2222-2222-2222-222222222222", student_id: "11111111-1111-1111-1111-111111111111", content_id: "c2222222-2222-2222-2222-222222222222", completed: true, completed_at: iso(now - 2 * DAY) },
];

// =================================================================
// ENROLLMENTS
// =================================================================
export const enrollments: Enrollment[] = [
  {
    id: "en-0001",
    student_id: "11111111-1111-1111-1111-111111111111",
    course_id: "co-saarthi-on",
    status: "active",
    fee_total: 40000,
    fee_collected: 25000,
    pending: 15000,
    installments: [
      { label: "Installment 1", amount: 25000, due: isoDate(now - 20 * DAY), paid: true },
      { label: "Installment 2", amount: 15000, due: isoDate(now + 25 * DAY), paid: false },
    ],
    progress: 38,
    enrolled_at: iso(now - 20 * DAY),
  },
  {
    id: "en-0002",
    student_id: "11111111-1111-1111-1111-111111111111",
    course_id: "co-ethics",
    status: "active",
    fee_total: 10000,
    fee_collected: 10000,
    pending: 0,
    installments: [{ label: "Full payment", amount: 10000, due: isoDate(now - 10 * DAY), paid: true }],
    progress: 64,
    enrolled_at: iso(now - 10 * DAY),
  },
  {
    id: "en-0003",
    student_id: "22222222-2222-2222-2222-222222222222",
    course_id: "co-pubad",
    status: "active",
    fee_total: 45000,
    fee_collected: 45000,
    pending: 0,
    installments: [{ label: "Full payment", amount: 45000, due: isoDate(now - 40 * DAY), paid: true }],
    progress: 20,
    enrolled_at: iso(now - 40 * DAY),
  },
];

// =================================================================
// LEADS (CRM)
// =================================================================
const SOURCES = ["Instagram", "Meta Form", "Webinar", "Demo", "Website", "WhatsApp", "Referral"];
const STATUSES: Lead["status"][] = ["New", "Contacted", "Demo Booked", "Demo Attended", "Negotiation", "Admitted", "Lost"];
const CITIES = ["Chandigarh", "Mohali", "Panchkula", "Ludhiana", "Amritsar", "Ambala", "Shimla", "Delhi"];

export const leads: Lead[] = Array.from({ length: 24 }).map((_, i) => {
  const status = STATUSES[i % STATUSES.length];
  const admitted = status === "Admitted";
  const total = admitted ? [40000, 75000, 45000, 10000][i % 4] : null;
  const collected = admitted ? Math.round((total || 0) * (i % 2 === 0 ? 0.6 : 1)) : null;
  return {
    id: `lead-${String(i + 1).padStart(4, "0")}`,
    name: `Lead Aspirant ${i + 1}`,
    phone: `90000${String(10000 + i).slice(-5)}`,
    city: CITIES[i % CITIES.length],
    state: i % 3 === 0 ? "Punjab" : i % 3 === 1 ? "Haryana" : "Himachal",
    source: SOURCES[i % SOURCES.length],
    campaign: i % 2 === 0 ? "Foundation 2027 Launch" : "₹50 Masterclass",
    course_interest: courses[i % courses.length].title,
    target_year: 2026 + (i % 3),
    mode_pref: i % 2 === 0 ? "Online" : "Offline",
    called: i % 3 !== 0,
    status,
    temperature: (["Interested", "Warm", "Cold", "Junk"] as const)[i % 4],
    demo_booked: ["Demo Booked", "Demo Attended", "Negotiation", "Admitted"].includes(status),
    demo_attended: ["Demo Attended", "Negotiation", "Admitted"].includes(status),
    webinar_registered: i % 2 === 0,
    webinar_attended: i % 4 === 0,
    admitted,
    course: admitted ? courses[i % courses.length].title : null,
    total_fee: total,
    amount_collected: collected,
    pending_balance: admitted ? (total || 0) - (collected || 0) : null,
    follow_up_date: i % 2 === 0 ? isoDate(now + (i % 5) * DAY) : isoDate(now - DAY),
    counsellor: i % 2 === 0 ? "Counsellor Priya" : "Counsellor Raj",
    created_at: iso(now - (i + 1) * DAY),
  };
});

export const leadActivities: LeadActivity[] = [
  { id: "la-1", lead_id: "lead-0001", type: "call", note: "Spoke about Foundation batch, interested.", counsellor: "Counsellor Priya", timestamp: iso(now - 2 * DAY) },
  { id: "la-2", lead_id: "lead-0001", type: "whatsapp", note: "Sent brochure + fee details.", counsellor: "Counsellor Priya", timestamp: iso(now - DAY) },
];

export const leadForms: LeadFormConfig[] = [
  { id: "lf-counselling", name: "Free Counselling", slug: "free-counselling", campaign: "Counselling", fields: ["name", "phone", "city", "target_year", "course_interest"], submissions: 142, created_at: iso(now - 60 * DAY) },
  { id: "lf-demo", name: "Demo Booking", slug: "demo-booking", campaign: "Demo", fields: ["name", "phone", "mode_pref"], submissions: 88, created_at: iso(now - 50 * DAY) },
  { id: "lf-enquiry", name: "Course Enquiry", slug: "course-enquiry", campaign: "Enquiry", fields: ["name", "phone", "course_interest"], submissions: 211, created_at: iso(now - 40 * DAY) },
  { id: "lf-webinar", name: "Webinar Registration", slug: "webinar-registration", campaign: "Webinar", fields: ["name", "phone", "city"], submissions: 363, created_at: iso(now - 30 * DAY) },
];

// =================================================================
// WEBINARS
// =================================================================
export const webinars: Webinar[] = [
  { id: "web-masterclass", slug: "beginner-upsc-masterclass", title: "₹50 Beginner UPSC Masterclass", description: "A 2-hour masterclass to kickstart your UPSC journey with the right strategy.", datetime: iso(now + 3 * DAY), link: "https://www.youtube.com/watch?v=placeholder", price: 50, capacity: 1000, registrations: 412, recording_link: null, status: "upcoming", created_at: iso(now - 10 * DAY) },
  { id: "web-optional", slug: "how-to-choose-optional", title: "How to Choose Your Optional Subject", description: "Free webinar on selecting the right optional for maximum scoring.", datetime: iso(now + 7 * DAY), link: "https://www.youtube.com/watch?v=placeholder", price: 0, capacity: 2000, registrations: 873, recording_link: null, status: "upcoming", created_at: iso(now - 8 * DAY) },
  { id: "web-prelims", slug: "prelims-2026-strategy", title: "Prelims 2026 — 90 Day Strategy", description: "Recording of our most-watched prelims strategy seminar.", datetime: iso(now - 12 * DAY), link: null, price: 0, capacity: null, registrations: 1540, recording_link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", status: "completed", created_at: iso(now - 30 * DAY) },
];

// =================================================================
// PAYMENTS
// =================================================================
export const payments: Payment[] = Array.from({ length: 14 }).map((_, i) => {
  const c = courses[i % courses.length];
  return {
    id: `pay-${String(i + 1).padStart(4, "0")}`,
    student_name: `Test Student ${i + 1}`,
    phone: `98${String(10000000 + i).slice(-8)}`,
    item: c.title,
    item_type: "course" as const,
    amount: c.price || 50,
    status: (["captured", "captured", "pending", "captured", "refunded"] as const)[i % 5],
    razorpay_payment_id: `pay_demo_${1000 + i}`,
    mode: c.modes[0],
    created_at: iso(now - i * 2 * DAY),
  };
});

// =================================================================
// REFERRALS
// =================================================================
export const referrals: Referral[] = [
  { id: "ref-1", referrer_name: "Test Sneha", referrer_phone: "9840044004", referee_name: "Friend One", tier: 3000, admitted: true, payout_status: "paid", created_at: iso(now - 30 * DAY) },
  { id: "ref-2", referrer_name: "Test Aarav", referrer_phone: "9810011001", referee_name: "Friend Two", tier: 1000, admitted: true, payout_status: "pending", created_at: iso(now - 12 * DAY) },
  { id: "ref-3", referrer_name: "Demo Student", referrer_phone: "9999999999", referee_name: "Friend Three", tier: 5000, admitted: false, payout_status: "pending", created_at: iso(now - 5 * DAY) },
];

// =================================================================
// STAFF
// =================================================================
export const staff: Staff[] = [
  { id: "st-1", name: "Naman Sir", username: DEMO_ADMIN.username, role: "Super Admin", email: "admin@example.com", active: true, created_at: iso(now - 200 * DAY) },
  { id: "st-2", name: "Counsellor Priya", username: "priya", role: "Counsellor", email: "priya@example.com", active: true, created_at: iso(now - 100 * DAY) },
  { id: "st-3", name: "Counsellor Raj", username: "raj", role: "Counsellor", email: "raj@example.com", active: true, created_at: iso(now - 80 * DAY) },
  { id: "st-4", name: "Content Team", username: "content", role: "Content Manager", email: "content@example.com", active: true, created_at: iso(now - 60 * DAY) },
];

// =================================================================
// ADMIN (demo compares plaintext from env; real bcrypt hash in seed.sql)
// =================================================================
export const adminUsers: (AdminUser & { plaintext_password: string; role: Staff["role"] })[] = [
  {
    id: "a1111111-1111-1111-1111-111111111111",
    username: DEMO_ADMIN.username,
    password_hash: "$2a$10$DEMOHASHnotusedindemomode00000000000000000000000000",
    plaintext_password: DEMO_ADMIN.password,
    role: "Super Admin",
    created_at: iso(now - 200 * DAY),
  },
];

// =================================================================
// QUIZ PLATFORM (demo data for local/mock mode)
// =================================================================
function q(partial: Partial<Question> & Pick<Question, "id" | "question_html" | "options" | "correct_option">): Question {
  return {
    question_image: null,
    passage_id: null,
    explanation_html: null,
    short_explanation: null,
    subject: "Polity",
    topic: null,
    subtopic: null,
    difficulty: "Moderate",
    tags: [],
    source: null,
    source_url: null,
    is_pyq: false,
    pyq_year: null,
    current_affairs_date: null,
    language: "English",
    status: "published",
    quality_status: "approved",
    allow_in_public_quiz: true,
    allow_in_paid_quiz: true,
    marks_override: null,
    negative_marks_override: null,
    duplicate_check_hash: null,
    created_by: "demo",
    created_at: iso(now - 5 * DAY),
    updated_at: iso(now - 5 * DAY),
    ...partial,
  };
}

export const questions: Question[] = [
  q({
    id: "qz-q-0001",
    question_html: "Which Article of the Indian Constitution deals with the Right to Constitutional Remedies?",
    options: { A: "Article 19", B: "Article 21", C: "Article 32", D: "Article 44" },
    correct_option: "C",
    explanation_html: "<p>Article 32 is called the 'heart and soul' of the Constitution by Dr. B. R. Ambedkar. It guarantees the right to move the Supreme Court for enforcement of Fundamental Rights.</p>",
    short_explanation: "Article 32 — Right to Constitutional Remedies.",
    subject: "Polity", topic: "Fundamental Rights", difficulty: "Easy",
    tags: ["constitution", "fundamental-rights"], is_pyq: true, pyq_year: 2019,
  }),
  q({
    id: "qz-q-0002",
    question_html: "The 'Doctrine of Basic Structure' was propounded by the Supreme Court in which case?",
    options: { A: "Golaknath case", B: "Kesavananda Bharati case", C: "Minerva Mills case", D: "Maneka Gandhi case" },
    correct_option: "B",
    explanation_html: "<p>The Basic Structure doctrine was established in the Kesavananda Bharati v. State of Kerala (1973) case.</p>",
    short_explanation: "Kesavananda Bharati case (1973).",
    subject: "Polity", topic: "Judiciary", difficulty: "Moderate", tags: ["judiciary", "amendments"],
  }),
  q({
    id: "qz-q-0003",
    question_html: "Which one of the following rivers is a tributary of the Brahmaputra?",
    options: { A: "Chambal", B: "Subansiri", C: "Betwa", D: "Son" },
    correct_option: "B",
    explanation_html: "<p>The Subansiri is the largest tributary of the Brahmaputra river.</p>",
    short_explanation: "Subansiri — largest tributary of the Brahmaputra.",
    subject: "Geography", topic: "Indian Rivers", difficulty: "Moderate", tags: ["rivers", "geography"],
  }),
];

export const quizzes: Quiz[] = [
  {
    id: "qz-0001",
    title: "Daily UPSC Prelims-style Quiz — Polity & Geography",
    slug: "daily-upsc-prelims-quiz-polity-geography",
    description: "A quick UPSC CSE-style MCQ practice set covering Polity and Geography fundamentals.",
    instructions_html: "<p>3 questions · 6 marks · negative marking 1/3. Read each question carefully.</p>",
    type: "FreePublic",
    exam_type: "PrelimsGS",
    subject: "General Studies",
    topic: null,
    quiz_date: isoDate(now),
    quiz_month: null,
    quiz_year: new Date(now).getFullYear(),
    difficulty: "Moderate",
    language: "English",
    thumbnail: null,
    status: "published",
    is_public: true,
    requires_login: false,
    requires_payment: false,
    time_limit_minutes: 10,
    marks_per_question: 2,
    negative_marking_enabled: true,
    negative_fraction: 0.3333,
    max_attempts: null,
    scoring_settings: { no_penalty_for_blank: true, negative_marks_type: "fraction" },
    timing_settings: { time_limit_enabled: true, auto_submit_on_time_end: true, server_time_validation: true, show_timer: true },
    attempt_settings: { access_without_login: true, randomize_question_order: false },
    result_settings: { show_result_immediately: true, show_score: true, show_correct_answers: true, show_explanations: true, show_answer_key: true, show_pdf_download: true },
    access_rules: {},
    seo: {
      seo_title: "Daily UPSC Prelims-style Quiz — Polity & Geography | Naman IAS",
      seo_description: "Free UPSC CSE-style MCQ practice. Attempt today's Prelims-style quiz with instant results and explanations.",
      indexable: true,
      include_in_sitemap: true,
      structured_data_enabled: true,
    },
    published_at: iso(now - 1 * DAY),
    created_by: "demo",
    created_at: iso(now - 2 * DAY),
    updated_at: iso(now - 1 * DAY),
  },
];

export const quizQuestions: QuizQuestion[] = questions.map((qq, i) => ({
  id: `qz-qq-${i + 1}`,
  quiz_id: "qz-0001",
  question_id: qq.id,
  order_index: i,
  section: null,
  marks: 2,
  negative_marks: 0.6667,
  snapshot: {
    question_html: qq.question_html,
    options: qq.options,
    correct_option: qq.correct_option,
    explanation_html: qq.explanation_html,
    short_explanation: qq.short_explanation,
    subject: qq.subject,
    topic: qq.topic,
    difficulty: qq.difficulty,
  },
  created_at: iso(now - 2 * DAY),
}));

export const quizAttempts: QuizAttempt[] = [];
export const quizAnswers: QuizAnswer[] = [];
export const importJobs: ImportJob[] = [];
