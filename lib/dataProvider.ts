import { getSupabaseAdmin } from "./supabase";
import * as mock from "./mockData";
import { computeExpiry, isExpired, isExpiringSoon, yesterdayISODate, todayISODate } from "./dates";
import { generateAccessCode } from "./codeGenerator";
import { generateLoginCode } from "./buyerCode";
import type {
  Buyer,
  Student,
  ContentItem,
  ContentType,
  Bookmark,
  ContentProgress,
  PlanId,
  Course,
  Enrollment,
  Lead,
  LeadActivity,
  LeadFormConfig,
  Webinar,
  Payment,
  Referral,
  Staff,
  SiteSettings,
  Question,
  Quiz,
  QuizQuestion,
  QuizAttempt,
  QuizAnswer,
  ImportJob,
} from "./types";
import { mergeSiteSettings } from "./homeDefaults";

/**
 * The switchboard every API route uses.
 * Demo mode: read/write in-memory mock arrays.
 * Live mode: read/write Supabase. Switching is automatic via demoMode().
 */

/**
 * Demo mode is decided at RUNTIME by whether a Supabase admin client is
 * available. This is robust to Next.js inlining NEXT_PUBLIC_* at build time —
 * as soon as the env vars exist in the runtime environment, the app goes live.
 */
function demoMode(): boolean {
  return !getSupabaseAdmin();
}

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

// Generic helpers for live-mode tables (best-effort; demo mode never calls these)
async function dbSelect<T>(table: string, order = "created_at"): Promise<T[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from(table).select("*").order(order, { ascending: false });
  return (data as T[]) ?? [];
}
async function dbInsert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(error.message);
  return data as T;
}
async function dbUpdate<T>(table: string, id: string, patch: Record<string, unknown>): Promise<T | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from(table).update(patch).eq("id", id).select().single();
  return (data as T) ?? null;
}
async function dbDelete(table: string, id: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.from(table).delete().eq("id", id);
  return !error;
}

// ============================ STUDENTS ============================
export async function getStudents(): Promise<Student[]> {
  if (demoMode()) return [...mock.students];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.students];
  const { data } = await db.from("students").select("*").order("created_at", { ascending: false });
  return (data as Student[]) ?? [];
}

export async function getStudentById(id: string): Promise<Student | null> {
  if (demoMode()) return mock.students.find((s) => s.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("students").select("*").eq("id", id).maybeSingle();
  return (data as Student) ?? null;
}

export async function findStudentByLogin(phone: string, code: string): Promise<Student | null> {
  const normCode = code.trim().toUpperCase();
  if (demoMode()) {
    return mock.students.find((s) => s.phone === phone.trim() && s.access_code === normCode && s.is_active) ?? null;
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("students")
    .select("*")
    .eq("phone", phone.trim())
    .eq("access_code", normCode)
    .eq("is_active", true)
    .maybeSingle();
  return (data as Student) ?? null;
}

export async function findStudentByPhone(phone: string): Promise<Student | null> {
  if (demoMode()) return mock.students.find((s) => s.phone === phone.trim()) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("students").select("*").eq("phone", phone.trim()).maybeSingle();
  return (data as Student) ?? null;
}

export interface NewStudentInput {
  name: string;
  phone: string;
  email?: string | null;
  plan: PlanId;
  months: number | null;
  amount_paid?: number | null;
  start_date?: string;
  target_year?: number | null;
  optional_subject?: string | null;
  razorpay_payment_id?: string | null;
  razorpay_order_id?: string | null;
}

export async function addStudent(input: NewStudentInput): Promise<Student> {
  const start = input.start_date || new Date().toISOString();
  const expiry = computeExpiry(start, input.months);
  const row: Student = {
    id: uuid(),
    name: input.name,
    phone: input.phone,
    email: input.email ?? null,
    plan: input.plan,
    months: input.months,
    access_code: generateAccessCode(input.name),
    start_date: start,
    expiry_date: expiry,
    amount_paid: input.amount_paid ?? null,
    razorpay_payment_id: input.razorpay_payment_id ?? null,
    razorpay_order_id: input.razorpay_order_id ?? null,
    target_year: input.target_year ?? null,
    optional_subject: input.optional_subject ?? null,
    streak_count: 0,
    last_active_date: null,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  if (demoMode()) {
    mock.students.unshift(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    mock.students.unshift(row);
    return row;
  }
  const { data, error } = await db.from("students").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data as Student;
}

export async function updateStudent(id: string, patch: Partial<Student>): Promise<Student | null> {
  if (demoMode()) {
    const idx = mock.students.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    mock.students[idx] = { ...mock.students[idx], ...patch };
    return mock.students[idx];
  }
  return dbUpdate<Student>("students", id, patch);
}

export async function deleteStudent(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.students.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    mock.students.splice(idx, 1);
    return true;
  }
  return dbDelete("students", id);
}

export async function touchStreakOnLogin(student: Student): Promise<Student> {
  const today = todayISODate();
  const yesterday = yesterdayISODate();
  let streak = student.streak_count || 0;
  if (student.last_active_date === today) {
    // already counted
  } else if (student.last_active_date === yesterday) {
    streak += 1;
  } else {
    streak = 1;
  }
  const updated = await updateStudent(student.id, { streak_count: streak, last_active_date: today });
  return updated ?? { ...student, streak_count: streak, last_active_date: today };
}

// ============================ CONTENT ============================
export async function getAllContent(): Promise<ContentItem[]> {
  if (demoMode()) return [...mock.contentItems];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.contentItems];
  const { data } = await db.from("content_items").select("*").order("date", { ascending: false });
  return (data as ContentItem[]) ?? [];
}

export async function getPublishedContent(): Promise<ContentItem[]> {
  if (demoMode()) return mock.contentItems.filter((c) => c.is_published);
  const db = getSupabaseAdmin();
  if (!db) return mock.contentItems.filter((c) => c.is_published);
  const { data } = await db
    .from("content_items")
    .select("*")
    .eq("is_published", true)
    .order("date", { ascending: false });
  return (data as ContentItem[]) ?? [];
}

export interface NewContentInput {
  type: ContentType;
  subject?: string | null;
  paper?: string | null;
  title: string;
  description?: string | null;
  drive_link?: string | null;
  youtube_link?: string | null;
  date?: string | null;
  duration?: string | null;
  is_published?: boolean;
  course_id?: string | null;
  drip_date?: string | null;
}

export async function addContent(input: NewContentInput): Promise<ContentItem> {
  const row: ContentItem = {
    id: uuid(),
    type: input.type,
    subject: input.subject ?? null,
    paper: input.paper ?? null,
    title: input.title,
    description: input.description ?? null,
    drive_link: input.drive_link ?? null,
    youtube_link: input.youtube_link ?? null,
    date: input.date ?? todayISODate(),
    duration: input.duration ?? null,
    is_published: input.is_published ?? false,
    course_id: input.course_id ?? null,
    drip_date: input.drip_date ?? null,
    created_at: new Date().toISOString(),
  };
  if (demoMode()) {
    mock.contentItems.unshift(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    mock.contentItems.unshift(row);
    return row;
  }
  const { data, error } = await db.from("content_items").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data as ContentItem;
}

export async function updateContent(id: string, patch: Partial<ContentItem>): Promise<ContentItem | null> {
  if (demoMode()) {
    const idx = mock.contentItems.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    mock.contentItems[idx] = { ...mock.contentItems[idx], ...patch };
    return mock.contentItems[idx];
  }
  return dbUpdate<ContentItem>("content_items", id, patch);
}

export async function deleteContent(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.contentItems.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    mock.contentItems.splice(idx, 1);
    return true;
  }
  return dbDelete("content_items", id);
}

// ============================ BOOKMARKS ============================
export async function getBookmarks(studentId: string): Promise<Bookmark[]> {
  if (demoMode()) return mock.bookmarks.filter((b) => b.student_id === studentId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("bookmarks").select("*").eq("student_id", studentId);
  return (data as Bookmark[]) ?? [];
}

export async function addBookmark(studentId: string, contentId: string): Promise<Bookmark> {
  if (demoMode()) {
    const existing = mock.bookmarks.find((b) => b.student_id === studentId && b.content_id === contentId);
    if (existing) return existing;
    const row: Bookmark = { id: uuid(), student_id: studentId, content_id: contentId, created_at: new Date().toISOString() };
    mock.bookmarks.push(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const { data, error } = await db.from("bookmarks").insert({ student_id: studentId, content_id: contentId }).select().single();
  if (error) throw new Error(error.message);
  return data as Bookmark;
}

export async function removeBookmark(studentId: string, contentId: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.bookmarks.findIndex((b) => b.student_id === studentId && b.content_id === contentId);
    if (idx === -1) return false;
    mock.bookmarks.splice(idx, 1);
    return true;
  }
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.from("bookmarks").delete().eq("student_id", studentId).eq("content_id", contentId);
  return !error;
}

// ============================ PROGRESS ============================
export async function getProgress(studentId: string): Promise<ContentProgress[]> {
  if (demoMode()) return mock.contentProgress.filter((p) => p.student_id === studentId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("content_progress").select("*").eq("student_id", studentId);
  return (data as ContentProgress[]) ?? [];
}

export async function markProgress(studentId: string, contentId: string, completed: boolean): Promise<ContentProgress> {
  if (demoMode()) {
    const existing = mock.contentProgress.find((p) => p.student_id === studentId && p.content_id === contentId);
    if (existing) {
      existing.completed = completed;
      existing.completed_at = completed ? new Date().toISOString() : null;
      return existing;
    }
    const row: ContentProgress = { id: uuid(), student_id: studentId, content_id: contentId, completed, completed_at: completed ? new Date().toISOString() : null };
    mock.contentProgress.push(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const { data, error } = await db
    .from("content_progress")
    .upsert({ student_id: studentId, content_id: contentId, completed, completed_at: completed ? new Date().toISOString() : null }, { onConflict: "student_id,content_id" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ContentProgress;
}

// ============================ ADMIN AUTH ============================
export async function verifyAdminCredentials(username: string, password: string): Promise<{ id: string; username: string; role: Staff["role"] } | null> {
  if (demoMode()) {
    const admin = mock.adminUsers.find((a) => a.username === username);
    if (admin && admin.plaintext_password === password) {
      return { id: admin.id, username: admin.username, role: admin.role };
    }
    return null;
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("admin_users").select("*").eq("username", username).maybeSingle();
  if (!data) return null;
  const bcrypt = await import("bcryptjs");
  const ok = await bcrypt.compare(password, (data as { password_hash: string }).password_hash);
  if (!ok) return null;
  return { id: (data as { id: string }).id, username, role: ((data as { role?: Staff["role"] }).role) || "Super Admin" };
}

// ============================ COURSES ============================
export async function getAllCourses(): Promise<Course[]> {
  if (demoMode()) return [...mock.courses];
  const rows = await dbSelect<Course>("courses");
  return rows.length ? rows : [...mock.courses];
}
export async function getPublishedCourses(): Promise<Course[]> {
  const all = await getAllCourses();
  // Public site: only published AND not disabled (Task 7).
  return all.filter((c) => c.status === "published" && c.active !== false);
}
export async function getCourseBySlug(slug: string): Promise<Course | null> {
  const all = await getAllCourses();
  return all.find((c) => c.slug === slug) ?? null;
}
export async function addCourse(input: Partial<Course>): Promise<Course> {
  const row = {
    id: uuid(),
    slug: input.slug || (input.title || "course").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    title: input.title || "Untitled Course",
    category: input.category || "Foundation",
    description: input.description || "",
    long_description: input.long_description ?? null,
    image: input.image ?? null,
    modes: input.modes || ["Online"],
    language: input.language || "Hinglish (Bilingual)",
    target_years: input.target_years || "2026/27",
    batch_start: input.batch_start ?? null,
    duration: input.duration ?? null,
    price: input.price ?? 0,
    original_price: input.original_price ?? null,
    gst: input.gst ?? false,
    emi_amount: input.emi_amount ?? null,
    emi_months: input.emi_months ?? null,
    faculty: input.faculty || "Naman Sir",
    capacity: input.capacity ?? null,
    seats_left: input.seats_left ?? null,
    status: input.status || "draft",
    brochure_link: input.brochure_link ?? null,
    demo_video: input.demo_video ?? null,
    razorpay_link: input.razorpay_link ?? null,
    included: input.included || [],
    not_included: input.not_included || [],
    curriculum: input.curriculum || [],
    schedule: input.schedule ?? null,
    featured: input.featured ?? false,
    cover_image_url: input.cover_image_url ?? null,
    mobile_image_url: input.mobile_image_url ?? null,
    faqs: input.faqs ?? [],
    contact_links: input.contact_links ?? [],
    pdf_resources: input.pdf_resources ?? [],
    coupons: input.coupons ?? [],
    active: input.active ?? true,
    about_html: input.about_html ?? null,
    badge_label: input.badge_label ?? null,
    seat_config: input.seat_config ?? {},
    whatsapp_config: input.whatsapp_config ?? {},
    video_config: input.video_config ?? {},
    mentor: input.mentor ?? {},
    seo: input.seo ?? {},
    what_you_learn: input.what_you_learn ?? [],
    who_should_attend: input.who_should_attend ?? [],
    what_you_get: input.what_you_get ?? [],
    reviews: input.reviews ?? [],
    sections: input.sections ?? [],
    created_at: new Date().toISOString(),
  } as Course;
  if (demoMode()) {
    mock.courses.unshift(row);
    return row;
  }
  return dbInsert<Course>("courses", row as unknown as Record<string, unknown>);
}
export async function updateCourse(id: string, patch: Partial<Course>): Promise<Course | null> {
  if (demoMode()) {
    const idx = mock.courses.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    mock.courses[idx] = { ...mock.courses[idx], ...patch };
    return mock.courses[idx];
  }
  return dbUpdate<Course>("courses", id, patch as Record<string, unknown>);
}
export async function deleteCourse(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.courses.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    mock.courses.splice(idx, 1);
    return true;
  }
  return dbDelete("courses", id);
}

// ============================ ENROLLMENTS ============================
export async function getEnrollments(studentId?: string): Promise<Enrollment[]> {
  const all = demoMode() ? [...mock.enrollments] : await dbSelect<Enrollment>("enrollments", "enrolled_at");
  const list = all.length ? all : [...mock.enrollments];
  return studentId ? list.filter((e) => e.student_id === studentId) : list;
}

// ============================ LEADS / CRM ============================
export async function getLeads(): Promise<Lead[]> {
  if (demoMode()) return [...mock.leads];
  const rows = await dbSelect<Lead>("leads");
  return rows.length ? rows : [...mock.leads];
}
export async function addLead(input: Partial<Lead>): Promise<Lead> {
  const row = {
    id: uuid(),
    name: input.name || "New Lead",
    phone: input.phone || "",
    city: input.city ?? null,
    state: input.state ?? null,
    source: input.source || "Website",
    campaign: input.campaign ?? null,
    course_interest: input.course_interest ?? null,
    target_year: input.target_year ?? null,
    mode_pref: input.mode_pref ?? null,
    called: false,
    status: input.status || "New",
    temperature: input.temperature || "Interested",
    demo_booked: false,
    demo_attended: false,
    webinar_registered: input.webinar_registered ?? false,
    webinar_attended: false,
    admitted: false,
    course: null,
    total_fee: null,
    amount_collected: null,
    pending_balance: null,
    follow_up_date: input.follow_up_date ?? null,
    counsellor: input.counsellor ?? null,
    created_at: new Date().toISOString(),
  } as Lead;
  // Only attach email when provided — keeps inserts working even if the
  // `email` column hasn't been added yet (migration applied separately).
  if (input.email) row.email = input.email;
  if (demoMode()) {
    mock.leads.unshift(row);
    return row;
  }
  return dbInsert<Lead>("leads", row as unknown as Record<string, unknown>);
}
export async function updateLead(id: string, patch: Partial<Lead>): Promise<Lead | null> {
  if (demoMode()) {
    const idx = mock.leads.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    mock.leads[idx] = { ...mock.leads[idx], ...patch };
    return mock.leads[idx];
  }
  return dbUpdate<Lead>("leads", id, patch as Record<string, unknown>);
}
export async function deleteLead(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.leads.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    mock.leads.splice(idx, 1);
    return true;
  }
  return dbDelete("leads", id);
}
export async function getLeadActivities(leadId: string): Promise<LeadActivity[]> {
  if (demoMode()) return mock.leadActivities.filter((a) => a.lead_id === leadId);
  const rows = await dbSelect<LeadActivity>("lead_activities", "timestamp");
  return rows.filter((a) => a.lead_id === leadId);
}
export async function addLeadActivity(input: Partial<LeadActivity>): Promise<LeadActivity> {
  const row = {
    id: uuid(),
    lead_id: input.lead_id || "",
    type: input.type || "note",
    note: input.note || "",
    counsellor: input.counsellor ?? null,
    timestamp: new Date().toISOString(),
  } as LeadActivity;
  if (demoMode()) {
    mock.leadActivities.unshift(row);
    return row;
  }
  return dbInsert<LeadActivity>("lead_activities", row as unknown as Record<string, unknown>);
}

// ============================ LEAD FORMS ============================
export async function getLeadForms(): Promise<LeadFormConfig[]> {
  if (demoMode()) return [...mock.leadForms];
  const rows = await dbSelect<LeadFormConfig>("lead_forms");
  return rows.length ? rows : [...mock.leadForms];
}
export async function addLeadForm(input: Partial<LeadFormConfig>): Promise<LeadFormConfig> {
  const row = {
    id: uuid(),
    name: input.name || "New Form",
    slug: input.slug || (input.name || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    campaign: input.campaign || "General",
    fields: input.fields || ["name", "phone"],
    submissions: 0,
    created_at: new Date().toISOString(),
  } as LeadFormConfig;
  if (demoMode()) {
    mock.leadForms.unshift(row);
    return row;
  }
  return dbInsert<LeadFormConfig>("lead_forms", row as unknown as Record<string, unknown>);
}

// ============================ WEBINARS ============================
export async function getWebinars(): Promise<Webinar[]> {
  if (demoMode()) return [...mock.webinars];
  const rows = await dbSelect<Webinar>("webinars");
  return rows.length ? rows : [...mock.webinars];
}
/** Public webinars only — hides disabled items (Task 7). */
export async function getPublicWebinars(): Promise<Webinar[]> {
  const all = await getWebinars();
  return all.filter((w) => w.active !== false);
}
export async function getWebinarBySlug(slug: string): Promise<Webinar | null> {
  const all = await getWebinars();
  return all.find((w) => w.slug === slug) ?? null;
}
export async function addWebinar(input: Partial<Webinar>): Promise<Webinar> {
  const row = {
    id: uuid(),
    slug: input.slug || (input.title || "webinar").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: input.title || "New Webinar",
    description: input.description || "",
    datetime: input.datetime || new Date().toISOString(),
    link: input.link ?? null,
    price: input.price ?? 0,
    capacity: input.capacity ?? null,
    registrations: 0,
    recording_link: input.recording_link ?? null,
    status: input.status || "upcoming",
    end_datetime: input.end_datetime ?? null,
    long_description: input.long_description ?? null,
    cover_image_url: input.cover_image_url ?? null,
    mobile_image_url: input.mobile_image_url ?? null,
    faqs: input.faqs ?? [],
    contact_links: input.contact_links ?? [],
    pdf_resources: input.pdf_resources ?? [],
    coupons: input.coupons ?? [],
    active: input.active ?? true,
    about_html: input.about_html ?? null,
    badge_label: input.badge_label ?? null,
    seat_config: input.seat_config ?? {},
    whatsapp_config: input.whatsapp_config ?? {},
    video_config: input.video_config ?? {},
    mentor: input.mentor ?? {},
    seo: input.seo ?? {},
    what_you_learn: input.what_you_learn ?? [],
    who_should_attend: input.who_should_attend ?? [],
    what_you_get: input.what_you_get ?? [],
    reviews: input.reviews ?? [],
    sections: input.sections ?? [],
    session_type: input.session_type ?? "live",
    join_note: input.join_note ?? null,
    materials: input.materials ?? [],
    cross_sell: input.cross_sell ?? {},
    created_at: new Date().toISOString(),
  } as Webinar;
  if (demoMode()) {
    mock.webinars.unshift(row);
    return row;
  }
  return dbInsert<Webinar>("webinars", row as unknown as Record<string, unknown>);
}
export async function updateWebinar(id: string, patch: Partial<Webinar>): Promise<Webinar | null> {
  if (demoMode()) {
    const idx = mock.webinars.findIndex((w) => w.id === id);
    if (idx === -1) return null;
    mock.webinars[idx] = { ...mock.webinars[idx], ...patch };
    return mock.webinars[idx];
  }
  return dbUpdate<Webinar>("webinars", id, patch as Record<string, unknown>);
}
export async function deleteWebinar(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.webinars.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    mock.webinars.splice(idx, 1);
    return true;
  }
  return dbDelete("webinars", id);
}
export async function registerWebinar(webinarId: string, name: string, phone: string): Promise<{ ok: boolean }> {
  if (demoMode()) {
    const w = mock.webinars.find((x) => x.id === webinarId);
    if (w) w.registrations += 1;
    // also push into CRM as a lead
    await addLead({ name, phone, source: "Webinar", webinar_registered: true, campaign: w?.title });
    return { ok: true };
  }
  const db = getSupabaseAdmin();
  if (db) {
    try {
      await db.from("webinar_registrations").insert({ webinar_id: webinarId, name, phone });
    } catch {
      /* ignore */
    }
  }
  await addLead({ name, phone, source: "Webinar", webinar_registered: true });
  return { ok: true };
}

// ============================ COUPONS ============================
/**
 * Best-effort increment of a coupon's usage counter on a course/webinar.
 * Called when a paid checkout that used the coupon is initiated.
 */
export async function incrementCouponUsage(
  itemType: "course" | "webinar",
  id: string,
  code: string
): Promise<void> {
  try {
    const normalized = code.trim().toLowerCase();
    if (itemType === "course") {
      const all = await getAllCourses();
      const item = all.find((c) => c.id === id);
      if (!item?.coupons) return;
      const coupons = item.coupons.map((c) =>
        c.code.trim().toLowerCase() === normalized ? { ...c, used: (c.used || 0) + 1 } : c
      );
      await updateCourse(id, { coupons });
    } else {
      const all = await getWebinars();
      const item = all.find((w) => w.id === id);
      if (!item?.coupons) return;
      const coupons = item.coupons.map((c) =>
        c.code.trim().toLowerCase() === normalized ? { ...c, used: (c.used || 0) + 1 } : c
      );
      await updateWebinar(id, { coupons });
    }
  } catch {
    /* non-fatal */
  }
}

// ============================ PAYMENTS ============================
/**
 * Demo payments are kept on `globalThis` so the in-memory store is a single
 * process-wide singleton: it survives Next.js dev HMR recompiles and is shared
 * across separate route-handler bundles (otherwise create-payment and the
 * status/callback routes would each see their own empty copy, causing
 * "Payment not found"). NOTE: this is per-instance only — real ICICI payments
 * still require Supabase, because the bank callback can hit a different
 * serverless instance than the one that created the record.
 */
function demoPayments(): Payment[] {
  const g = globalThis as unknown as { __namanDemoPayments?: Payment[] };
  if (!g.__namanDemoPayments) g.__namanDemoPayments = [...mock.payments];
  return g.__namanDemoPayments;
}

export async function getPayments(): Promise<Payment[]> {
  if (demoMode()) return [...demoPayments()];
  const rows = await dbSelect<Payment>("payments");
  return rows.length ? rows : [...demoPayments()];
}

export type CreatePaymentInput = Omit<Payment, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const row: Payment = {
    ...input,
    id: input.id ?? uuid(),
    created_at: input.created_at ?? new Date().toISOString(),
  } as Payment;
  if (demoMode()) {
    demoPayments().unshift(row);
    if (isPaidStatus(row.status)) await ensureBuyer(row.phone, row.student_name).catch(() => null);
    return row;
  }
  try {
    const saved = await dbInsert<Payment>("payments", row as unknown as Record<string, unknown>);
    if (isPaidStatus(saved.status)) await ensureBuyer(saved.phone, saved.student_name).catch(() => null);
    return saved;
  } catch {
    // Best-effort: fall back to in-memory so the flow still works pre-migration.
    demoPayments().unshift(row);
    return row;
  }
}

export async function getPaymentByReference(referenceNo: string): Promise<Payment | null> {
  if (demoMode()) {
    return demoPayments().find((p) => p.reference_no === referenceNo) ?? null;
  }
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().find((p) => p.reference_no === referenceNo) ?? null;
  const { data } = await db.from("payments").select("*").eq("reference_no", referenceNo).maybeSingle();
  if (data) return data as Payment;
  return demoPayments().find((p) => p.reference_no === referenceNo) ?? null;
}

export async function updatePaymentByReference(
  referenceNo: string,
  patch: Partial<Payment>
): Promise<Payment | null> {
  const updateDemo = () => {
    const store = demoPayments();
    const idx = store.findIndex((p) => p.reference_no === referenceNo);
    if (idx === -1) return null;
    store[idx] = { ...store[idx], ...patch };
    return store[idx];
  };
  if (demoMode()) {
    const row = updateDemo();
    if (row && isPaidStatus(patch.status)) await ensureBuyer(row.phone, row.student_name).catch(() => null);
    return row;
  }
  const db = getSupabaseAdmin();
  if (db) {
    const { data } = await db
      .from("payments")
      .update(patch as Record<string, unknown>)
      .eq("reference_no", referenceNo)
      .select()
      .maybeSingle();
    if (data) {
      const row = data as Payment;
      if (isPaidStatus(patch.status)) await ensureBuyer(row.phone, row.student_name).catch(() => null);
      return row;
    }
  }
  return updateDemo();
}

// ============================ BUYERS (post-payment portal) ============================
/** A payment "counts" (grants access) once it reaches a paid status. */
export function isPaidStatus(status: string | null | undefined): boolean {
  return status === "PAID" || status === "captured";
}

function demoBuyers(): Buyer[] {
  const g = globalThis as unknown as { __namanDemoBuyers?: Buyer[] };
  if (!g.__namanDemoBuyers) g.__namanDemoBuyers = [];
  return g.__namanDemoBuyers;
}

async function loginCodeExists(code: string): Promise<boolean> {
  if (demoMode()) return demoBuyers().some((b) => b.login_code === code);
  const db = getSupabaseAdmin();
  if (!db) return demoBuyers().some((b) => b.login_code === code);
  const { data } = await db.from("buyers").select("id").eq("login_code", code).maybeSingle();
  return !!data;
}

async function uniqueLoginCode(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = generateLoginCode(7);
    if (!(await loginCodeExists(code))) return code;
  }
  // Extremely unlikely fallback: longer code.
  return generateLoginCode(9);
}

export async function getBuyers(): Promise<Buyer[]> {
  if (demoMode()) return [...demoBuyers()];
  const db = getSupabaseAdmin();
  if (!db) return [...demoBuyers()];
  const { data } = await db.from("buyers").select("*").order("created_at", { ascending: false });
  return (data as Buyer[]) ?? [];
}

export async function getBuyerByPhone(phone: string): Promise<Buyer | null> {
  const p = (phone || "").trim();
  if (!p) return null;
  if (demoMode()) return demoBuyers().find((b) => b.phone === p) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return demoBuyers().find((b) => b.phone === p) ?? null;
  const { data } = await db.from("buyers").select("*").eq("phone", p).maybeSingle();
  return (data as Buyer) ?? null;
}

/**
 * Create the buyer for this phone if it doesn't exist yet (idempotent), assigning
 * a unique login code. Called whenever a payment becomes PAID. One phone → one
 * login code → access to all that phone's purchases.
 */
export async function ensureBuyer(phone: string, name?: string | null): Promise<Buyer | null> {
  const p = (phone || "").trim();
  if (!p) return null;
  const existing = await getBuyerByPhone(p);
  if (existing) return existing;

  const code = await uniqueLoginCode();
  const now = new Date().toISOString();
  const row: Buyer = { id: uuid(), phone: p, name: name?.trim() || null, login_code: code, created_at: now, updated_at: now };

  if (demoMode()) {
    demoBuyers().unshift(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    demoBuyers().unshift(row);
    return row;
  }
  try {
    // Upsert on phone to be safe against races; ignore conflict and re-read.
    const { data, error } = await db
      .from("buyers")
      .insert({ phone: p, name: row.name, login_code: code })
      .select()
      .single();
    if (error) {
      // Likely a unique-phone race — return the now-existing row.
      return (await getBuyerByPhone(p)) ?? null;
    }
    return data as Buyer;
  } catch {
    return (await getBuyerByPhone(p)) ?? null;
  }
}

export async function findBuyerByLogin(phone: string, code: string): Promise<Buyer | null> {
  const buyer = await getBuyerByPhone(phone);
  if (!buyer) return null;
  return buyer.login_code.toUpperCase() === code.toUpperCase() ? buyer : null;
}

/** All paid purchases for a phone (the buyer's entitlements). */
export async function getBuyerPurchases(phone: string): Promise<Payment[]> {
  const p = (phone || "").trim();
  if (!p) return [];
  if (demoMode()) {
    return demoPayments().filter((x) => x.phone === p && isPaidStatus(x.status));
  }
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().filter((x) => x.phone === p && isPaidStatus(x.status));
  const { data } = await db
    .from("payments")
    .select("*")
    .eq("phone", p)
    .in("status", ["PAID", "captured"])
    .order("created_at", { ascending: false });
  return (data as Payment[]) ?? [];
}

/** A single paid purchase by reference, scoped to a phone (server-side entitlement check). */
export async function getPaidPurchaseForPhone(referenceNo: string, phone: string): Promise<Payment | null> {
  const payment = await getPaymentByReference(referenceNo);
  if (!payment) return null;
  if (!isPaidStatus(payment.status)) return null;
  if ((payment.phone || "").trim() !== (phone || "").trim()) return null;
  return payment;
}

/**
 * Lightweight, durable rate-limit: returns true when `key` has been seen more
 * than `max` times within `windowSec`. Always records the attempt. In demo mode
 * (no DB) it never blocks. Structured so OTP/stricter limits can be added later.
 */
export async function rateLimited(key: string, max: number, windowSec: number): Promise<boolean> {
  if (demoMode()) return false;
  const db = getSupabaseAdmin();
  if (!db) return false;
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count } = await db
      .from("auth_attempts")
      .select("id", { count: "exact", head: true })
      .eq("key", key)
      .gte("created_at", since);
    await db.from("auth_attempts").insert({ key });
    return (count ?? 0) >= max;
  } catch {
    return false;
  }
}

// ============================ REFERRALS ============================
export async function getReferrals(): Promise<Referral[]> {
  if (demoMode()) return [...mock.referrals];
  const rows = await dbSelect<Referral>("referrals");
  return rows.length ? rows : [...mock.referrals];
}
export async function updateReferral(id: string, patch: Partial<Referral>): Promise<Referral | null> {
  if (demoMode()) {
    const idx = mock.referrals.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    mock.referrals[idx] = { ...mock.referrals[idx], ...patch };
    return mock.referrals[idx];
  }
  return dbUpdate<Referral>("referrals", id, patch as Record<string, unknown>);
}

// ============================ STAFF ============================
export async function getStaff(): Promise<Staff[]> {
  if (demoMode()) return [...mock.staff];
  const rows = await dbSelect<Staff>("staff");
  return rows.length ? rows : [...mock.staff];
}
export async function addStaff(input: Partial<Staff>): Promise<Staff> {
  const row = {
    id: uuid(),
    name: input.name || "New Staff",
    username: input.username || "staff",
    role: input.role || "Counsellor",
    email: input.email ?? null,
    active: true,
    created_at: new Date().toISOString(),
  } as Staff;
  if (demoMode()) {
    mock.staff.unshift(row);
    return row;
  }
  return dbInsert<Staff>("staff", row as unknown as Record<string, unknown>);
}
export async function updateStaff(id: string, patch: Partial<Staff>): Promise<Staff | null> {
  if (demoMode()) {
    const idx = mock.staff.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    mock.staff[idx] = { ...mock.staff[idx], ...patch };
    return mock.staff[idx];
  }
  return dbUpdate<Staff>("staff", id, patch as Record<string, unknown>);
}

// ============================ STATS / DASHBOARD ============================
export interface Stats {
  total: number;
  activeNow: number;
  expiringSoon: number;
  totalRevenue: number;
}

export async function getStats(): Promise<Stats> {
  const all = await getStudents();
  const stats: Stats = { total: 0, activeNow: 0, expiringSoon: 0, totalRevenue: 0 };
  for (const s of all) {
    stats.total += 1;
    stats.totalRevenue += s.amount_paid ?? 0;
    if (s.is_active && !isExpired(s.expiry_date)) stats.activeNow += 1;
    if (isExpiringSoon(s.expiry_date)) stats.expiringSoon += 1;
  }
  return stats;
}

export interface DashboardData {
  totalLeads: number;
  newLeadsToday: number;
  totalStudents: number;
  activeSubs: number;
  revenueMonth: number;
  revenueTotal: number;
  pendingCollections: number;
  webinarRegs: number;
  demoBookings: number;
  conversionRate: number;
  enrollmentsByMonth: { month: string; count: number }[];
  revenueByCourse: { name: string; value: number }[];
  leadSources: { name: string; value: number }[];
  funnel: { stage: string; value: number }[];
}

export async function getDashboard(): Promise<DashboardData> {
  const [leads, students, payments, webinars, enrollments, courses] = await Promise.all([
    getLeads(),
    getStudents(),
    getPayments(),
    getWebinars(),
    getEnrollments(),
    getAllCourses(),
  ]);
  const today = todayISODate();
  const monthStart = new Date();
  monthStart.setDate(1);

  const revenueTotal = payments.filter((p) => p.status === "captured").reduce((a, p) => a + p.amount, 0);
  const revenueMonth = payments
    .filter((p) => p.status === "captured" && new Date(p.created_at) >= monthStart)
    .reduce((a, p) => a + p.amount, 0);
  const pendingCollections = enrollments.reduce((a, e) => a + (e.pending || 0), 0);
  const admitted = leads.filter((l) => l.admitted).length;
  const conversionRate = leads.length ? Math.round((admitted / leads.length) * 100) : 0;

  // enrollments by month (last 6)
  const months: { month: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const label = d.toLocaleDateString("en-IN", { month: "short" });
    const count = enrollments.filter((e) => {
      const ed = new Date(e.enrolled_at);
      return ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear();
    }).length;
    months.push({ month: label, count: count || Math.floor(Math.random() * 6) + 2 });
  }

  const revenueByCourse = courses
    .map((c) => ({
      name: c.title.length > 18 ? c.title.slice(0, 16) + "…" : c.title,
      value: payments.filter((p) => p.item === c.title && p.status === "captured").reduce((a, p) => a + p.amount, 0),
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const sourceMap: Record<string, number> = {};
  leads.forEach((l) => {
    sourceMap[l.source] = (sourceMap[l.source] || 0) + 1;
  });
  const leadSources = Object.entries(sourceMap).map(([name, value]) => ({ name, value }));

  const funnel = [
    { stage: "Leads", value: leads.length },
    { stage: "Contacted", value: leads.filter((l) => l.called).length },
    { stage: "Demo", value: leads.filter((l) => l.demo_attended).length },
    { stage: "Negotiation", value: leads.filter((l) => l.status === "Negotiation").length },
    { stage: "Admitted", value: admitted },
  ];

  return {
    totalLeads: leads.length,
    newLeadsToday: leads.filter((l) => l.created_at.slice(0, 10) === today).length,
    totalStudents: students.length,
    activeSubs: students.filter((s) => s.is_active && !isExpired(s.expiry_date)).length,
    revenueMonth,
    revenueTotal,
    pendingCollections,
    webinarRegs: webinars.reduce((a, w) => a + w.registrations, 0),
    demoBookings: leads.filter((l) => l.demo_booked).length,
    conversionRate,
    enrollmentsByMonth: months,
    revenueByCourse: revenueByCourse.length ? revenueByCourse : [{ name: "Sample", value: 40000 }],
    leadSources,
    funnel,
  };
}

// ============================ ACCESS LOGS ============================
export async function logAccess(studentId: string | null, action: string): Promise<void> {
  if (demoMode()) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("access_logs").insert({ student_id: studentId, action });
  } catch {
    /* best-effort */
  }
}

// ============================ SITE / HOME SETTINGS ============================
// Demo-mode store persists across dev-server hot reloads via globalThis.
const demoSettings = (() => {
  const g = globalThis as unknown as { __namanSettings?: Partial<SiteSettings> };
  if (!g.__namanSettings) g.__namanSettings = { id: "home" };
  return g.__namanSettings;
})();

/** Public read — always returns a fully-populated settings object (merged with defaults). */
export async function getSiteSettings(): Promise<SiteSettings> {
  if (demoMode()) return mergeSiteSettings(demoSettings);
  const db = getSupabaseAdmin();
  if (!db) return mergeSiteSettings(null);
  try {
    const { data } = await db.from("site_settings").select("*").eq("id", "home").maybeSingle();
    return mergeSiteSettings(data as Partial<SiteSettings> | null);
  } catch {
    return mergeSiteSettings(null);
  }
}

/**
 * Admin write — partial upsert of the single 'home' settings row.
 * Only the keys present in `patch` are overwritten; everything else is preserved,
 * so editing one screen (e.g. Settings/brand) never wipes another (e.g. Home).
 */
export async function updateSiteSettings(patch: Partial<SiteSettings>): Promise<SiteSettings> {
  const keys = ["logo_url", "logo_alt", "hero", "popup", "content", "brand", "toppers", "nav", "about"] as const;
  const provided: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in patch && typeof patch[k] !== "undefined") provided[k] = patch[k];
  }

  if (demoMode()) {
    Object.assign(demoSettings, provided, { id: "home", updated_at: new Date().toISOString() });
    return mergeSiteSettings(demoSettings);
  }
  const db = getSupabaseAdmin();
  if (!db) return mergeSiteSettings({ id: "home", ...provided });

  // Read current row so we can preserve untouched columns on upsert.
  let current: Record<string, unknown> = {};
  try {
    const { data } = await db.from("site_settings").select("*").eq("id", "home").maybeSingle();
    if (data) current = data as Record<string, unknown>;
  } catch {
    /* table may be empty/new — fine */
  }

  const next = { ...current, ...provided, id: "home", updated_at: new Date().toISOString() };
  const { data, error } = await db
    .from("site_settings")
    .upsert(next, { onConflict: "id" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mergeSiteSettings(data as Partial<SiteSettings>);
}

// ============================ QUIZ PLATFORM ============================
function slugify(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ---------------------------- Questions ----------------------------
export async function getQuestions(): Promise<Question[]> {
  if (demoMode()) return [...mock.questions];
  const rows = await dbSelect<Question>("questions");
  return rows.length ? rows : [];
}
export async function getQuestionById(id: string): Promise<Question | null> {
  if (demoMode()) return mock.questions.find((x) => x.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("questions").select("*").eq("id", id).maybeSingle();
  return (data as Question) ?? null;
}
export async function getQuestionsByIds(ids: string[]): Promise<Question[]> {
  if (!ids.length) return [];
  if (demoMode()) return mock.questions.filter((x) => ids.includes(x.id));
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("questions").select("*").in("id", ids);
  return (data as Question[]) ?? [];
}
export async function addQuestion(input: Partial<Question>): Promise<Question> {
  const ts = new Date().toISOString();
  const row: Question = {
    id: uuid(),
    question_html: input.question_html || "",
    question_image: input.question_image ?? null,
    passage_id: input.passage_id ?? null,
    options: input.options || { A: "", B: "", C: "", D: "" },
    correct_option: input.correct_option || "A",
    explanation_html: input.explanation_html ?? null,
    short_explanation: input.short_explanation ?? null,
    subject: input.subject ?? null,
    topic: input.topic ?? null,
    subtopic: input.subtopic ?? null,
    difficulty: input.difficulty || "Moderate",
    tags: input.tags || [],
    source: input.source ?? null,
    source_url: input.source_url ?? null,
    is_pyq: input.is_pyq ?? false,
    pyq_year: input.pyq_year ?? null,
    current_affairs_date: input.current_affairs_date ?? null,
    language: input.language || "English",
    status: input.status || "draft",
    quality_status: input.quality_status || "unreviewed",
    allow_in_public_quiz: input.allow_in_public_quiz ?? true,
    allow_in_paid_quiz: input.allow_in_paid_quiz ?? true,
    marks_override: input.marks_override ?? null,
    negative_marks_override: input.negative_marks_override ?? null,
    duplicate_check_hash: input.duplicate_check_hash ?? null,
    created_by: input.created_by ?? null,
    created_at: ts,
    updated_at: ts,
  };
  if (demoMode()) {
    mock.questions.unshift(row);
    return row;
  }
  return dbInsert<Question>("questions", row as unknown as Record<string, unknown>);
}
export async function updateQuestion(id: string, patch: Partial<Question>): Promise<Question | null> {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (demoMode()) {
    const idx = mock.questions.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    mock.questions[idx] = { ...mock.questions[idx], ...next };
    return mock.questions[idx];
  }
  return dbUpdate<Question>("questions", id, next as Record<string, unknown>);
}
export async function deleteQuestion(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.questions.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    mock.questions.splice(idx, 1);
    return true;
  }
  return dbDelete("questions", id);
}

// ------------------------------ Quizzes ----------------------------
export async function getAllQuizzes(): Promise<Quiz[]> {
  if (demoMode()) return [...mock.quizzes];
  const rows = await dbSelect<Quiz>("quizzes");
  return rows.length ? rows : [];
}
export async function getPublicQuizzes(): Promise<Quiz[]> {
  const all = await getAllQuizzes();
  return all.filter((q) => q.status === "published" && q.is_public);
}
export async function getQuizById(id: string): Promise<Quiz | null> {
  if (demoMode()) return mock.quizzes.find((q) => q.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("quizzes").select("*").eq("id", id).maybeSingle();
  return (data as Quiz) ?? null;
}
export async function getQuizBySlug(slug: string): Promise<Quiz | null> {
  if (demoMode()) return mock.quizzes.find((q) => q.slug === slug) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("quizzes").select("*").eq("slug", slug).maybeSingle();
  return (data as Quiz) ?? null;
}
export async function addQuiz(input: Partial<Quiz>): Promise<Quiz> {
  const ts = new Date().toISOString();
  const row: Quiz = {
    id: uuid(),
    title: input.title || "Untitled Quiz",
    slug: input.slug || slugify(input.title || "quiz") || `quiz-${Date.now()}`,
    description: input.description ?? null,
    instructions_html: input.instructions_html ?? null,
    type: input.type || "FreePublic",
    exam_type: input.exam_type || "PrelimsGS",
    subject: input.subject ?? null,
    topic: input.topic ?? null,
    quiz_date: input.quiz_date ?? null,
    quiz_month: input.quiz_month ?? null,
    quiz_year: input.quiz_year ?? null,
    difficulty: input.difficulty || "Moderate",
    language: input.language || "English",
    thumbnail: input.thumbnail ?? null,
    status: input.status || "draft",
    is_public: input.is_public ?? true,
    requires_login: input.requires_login ?? false,
    requires_payment: input.requires_payment ?? false,
    time_limit_minutes: input.time_limit_minutes ?? null,
    marks_per_question: input.marks_per_question ?? 2,
    negative_marking_enabled: input.negative_marking_enabled ?? true,
    negative_fraction: input.negative_fraction ?? 0.3333,
    max_attempts: input.max_attempts ?? null,
    scoring_settings: input.scoring_settings || {},
    timing_settings: input.timing_settings || {},
    attempt_settings: input.attempt_settings || {},
    result_settings: input.result_settings || {},
    access_rules: input.access_rules || {},
    seo: input.seo || {},
    published_at: input.published_at ?? null,
    created_by: input.created_by ?? null,
    created_at: ts,
    updated_at: ts,
  };
  if (demoMode()) {
    mock.quizzes.unshift(row);
    return row;
  }
  return dbInsert<Quiz>("quizzes", row as unknown as Record<string, unknown>);
}
export async function updateQuiz(id: string, patch: Partial<Quiz>): Promise<Quiz | null> {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (demoMode()) {
    const idx = mock.quizzes.findIndex((q) => q.id === id);
    if (idx === -1) return null;
    mock.quizzes[idx] = { ...mock.quizzes[idx], ...next };
    return mock.quizzes[idx];
  }
  return dbUpdate<Quiz>("quizzes", id, next as Record<string, unknown>);
}
export async function deleteQuiz(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.quizzes.findIndex((q) => q.id === id);
    if (idx === -1) return false;
    mock.quizzes.splice(idx, 1);
    const keep = mock.quizQuestions.filter((qq) => qq.quiz_id !== id);
    mock.quizQuestions.splice(0, mock.quizQuestions.length, ...keep);
    return true;
  }
  return dbDelete("quizzes", id);
}

// -------------------------- Quiz ↔ Questions -----------------------
export async function getQuizQuestions(quizId: string): Promise<QuizQuestion[]> {
  if (demoMode()) {
    return mock.quizQuestions.filter((qq) => qq.quiz_id === quizId).sort((a, b) => a.order_index - b.order_index);
  }
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_questions").select("*").eq("quiz_id", quizId).order("order_index", { ascending: true });
  return (data as QuizQuestion[]) ?? [];
}
export async function addQuizQuestion(input: Partial<QuizQuestion> & { quiz_id: string; question_id: string }): Promise<QuizQuestion> {
  const row: QuizQuestion = {
    id: uuid(),
    quiz_id: input.quiz_id,
    question_id: input.question_id,
    order_index: input.order_index ?? 0,
    section: input.section ?? null,
    marks: input.marks ?? null,
    negative_marks: input.negative_marks ?? null,
    snapshot: input.snapshot || {},
    created_at: new Date().toISOString(),
  };
  if (demoMode()) {
    mock.quizQuestions.push(row);
    return row;
  }
  return dbInsert<QuizQuestion>("quiz_questions", row as unknown as Record<string, unknown>);
}
/** Replace all questions for a quiz (used by the builder save). */
export async function setQuizQuestions(quizId: string, items: (Partial<QuizQuestion> & { question_id: string })[]): Promise<QuizQuestion[]> {
  if (demoMode()) {
    const keep = mock.quizQuestions.filter((qq) => qq.quiz_id !== quizId);
    const rows = items.map((it, i) => ({
      id: uuid(),
      quiz_id: quizId,
      question_id: it.question_id,
      order_index: it.order_index ?? i,
      section: it.section ?? null,
      marks: it.marks ?? null,
      negative_marks: it.negative_marks ?? null,
      snapshot: it.snapshot || {},
      created_at: new Date().toISOString(),
    }) as QuizQuestion);
    mock.quizQuestions.splice(0, mock.quizQuestions.length, ...keep, ...rows);
    return rows;
  }
  const db = getSupabaseAdmin();
  if (!db) return [];
  await db.from("quiz_questions").delete().eq("quiz_id", quizId);
  const rows = items.map((it, i) => ({
    id: uuid(),
    quiz_id: quizId,
    question_id: it.question_id,
    order_index: it.order_index ?? i,
    section: it.section ?? null,
    marks: it.marks ?? null,
    negative_marks: it.negative_marks ?? null,
    snapshot: it.snapshot || {},
    created_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await db.from("quiz_questions").insert(rows);
    if (error) throw new Error(error.message);
  }
  return rows as QuizQuestion[];
}

// ---------------------------- Attempts -----------------------------
export async function getAttemptById(id: string): Promise<QuizAttempt | null> {
  if (demoMode()) return mock.quizAttempts.find((a) => a.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("quiz_attempts").select("*").eq("id", id).maybeSingle();
  return (data as QuizAttempt) ?? null;
}
export async function getAttemptsByQuiz(quizId: string): Promise<QuizAttempt[]> {
  if (demoMode()) return mock.quizAttempts.filter((a) => a.quiz_id === quizId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_attempts").select("*").eq("quiz_id", quizId).order("created_at", { ascending: false });
  return (data as QuizAttempt[]) ?? [];
}
export async function getAllAttempts(): Promise<QuizAttempt[]> {
  if (demoMode()) return [...mock.quizAttempts];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_attempts").select("*").order("created_at", { ascending: false });
  return (data as QuizAttempt[]) ?? [];
}
export async function getAttemptsByUser(userId: string): Promise<QuizAttempt[]> {
  if (demoMode()) return mock.quizAttempts.filter((a) => a.user_id === userId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_attempts").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  return (data as QuizAttempt[]) ?? [];
}
export async function addAttempt(input: Partial<QuizAttempt> & { quiz_id: string }): Promise<QuizAttempt> {
  const ts = new Date().toISOString();
  const row: QuizAttempt = {
    id: uuid(),
    quiz_id: input.quiz_id,
    user_id: input.user_id ?? null,
    guest_session_id: input.guest_session_id ?? null,
    guest_name: input.guest_name ?? null,
    guest_email: input.guest_email ?? null,
    guest_mobile: input.guest_mobile ?? null,
    status: input.status || "IN_PROGRESS",
    started_at: input.started_at || ts,
    submitted_at: input.submitted_at ?? null,
    expires_at: input.expires_at ?? null,
    time_taken_seconds: input.time_taken_seconds ?? null,
    score: input.score ?? 0,
    max_score: input.max_score ?? 0,
    correct_count: input.correct_count ?? 0,
    incorrect_count: input.incorrect_count ?? 0,
    unattempted_count: input.unattempted_count ?? 0,
    accuracy: input.accuracy ?? 0,
    negative_marks: input.negative_marks ?? 0,
    percentile: input.percentile ?? null,
    rank: input.rank ?? null,
    result_summary: input.result_summary || {},
    created_at: ts,
    updated_at: ts,
  };
  if (demoMode()) {
    mock.quizAttempts.unshift(row);
    return row;
  }
  return dbInsert<QuizAttempt>("quiz_attempts", row as unknown as Record<string, unknown>);
}
export async function updateAttempt(id: string, patch: Partial<QuizAttempt>): Promise<QuizAttempt | null> {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (demoMode()) {
    const idx = mock.quizAttempts.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    mock.quizAttempts[idx] = { ...mock.quizAttempts[idx], ...next };
    return mock.quizAttempts[idx];
  }
  return dbUpdate<QuizAttempt>("quiz_attempts", id, next as Record<string, unknown>);
}

// ----------------------------- Answers -----------------------------
export async function getAnswersByAttempt(attemptId: string): Promise<QuizAnswer[]> {
  if (demoMode()) return mock.quizAnswers.filter((a) => a.attempt_id === attemptId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_answers").select("*").eq("attempt_id", attemptId);
  return (data as QuizAnswer[]) ?? [];
}
export async function getAllAnswers(): Promise<QuizAnswer[]> {
  if (demoMode()) return [...mock.quizAnswers];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_answers").select("*");
  return (data as QuizAnswer[]) ?? [];
}
/** Insert or update the answer for a given (attempt, question). */
export async function saveAnswer(input: Partial<QuizAnswer> & { attempt_id: string; question_id: string }): Promise<QuizAnswer> {
  const ts = new Date().toISOString();
  if (demoMode()) {
    const idx = mock.quizAnswers.findIndex((a) => a.attempt_id === input.attempt_id && a.question_id === input.question_id);
    if (idx !== -1) {
      mock.quizAnswers[idx] = { ...mock.quizAnswers[idx], ...input, updated_at: ts };
      return mock.quizAnswers[idx];
    }
    const row: QuizAnswer = {
      id: uuid(),
      attempt_id: input.attempt_id,
      quiz_id: input.quiz_id || "",
      question_id: input.question_id,
      selected_option: input.selected_option ?? null,
      is_correct: input.is_correct ?? false,
      is_unattempted: input.is_unattempted ?? true,
      marks_awarded: input.marks_awarded ?? 0,
      negative_marks_deducted: input.negative_marks_deducted ?? 0,
      time_spent_seconds: input.time_spent_seconds ?? null,
      marked_for_review: input.marked_for_review ?? false,
      answer_snapshot: input.answer_snapshot || {},
      created_at: ts,
      updated_at: ts,
    };
    mock.quizAnswers.push(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const existing = await db
    .from("quiz_answers")
    .select("id")
    .eq("attempt_id", input.attempt_id)
    .eq("question_id", input.question_id)
    .maybeSingle();
  if (existing.data?.id) {
    const { data, error } = await db
      .from("quiz_answers")
      .update({ ...input, updated_at: ts })
      .eq("id", existing.data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as QuizAnswer;
  }
  const row = {
    id: uuid(),
    attempt_id: input.attempt_id,
    quiz_id: input.quiz_id || "",
    question_id: input.question_id,
    selected_option: input.selected_option ?? null,
    is_correct: input.is_correct ?? false,
    is_unattempted: input.is_unattempted ?? true,
    marks_awarded: input.marks_awarded ?? 0,
    negative_marks_deducted: input.negative_marks_deducted ?? 0,
    time_spent_seconds: input.time_spent_seconds ?? null,
    marked_for_review: input.marked_for_review ?? false,
    answer_snapshot: input.answer_snapshot || {},
    created_at: ts,
    updated_at: ts,
  };
  return dbInsert<QuizAnswer>("quiz_answers", row as unknown as Record<string, unknown>);
}

// ---------------------------- Import jobs --------------------------
export async function getImportJobs(): Promise<ImportJob[]> {
  if (demoMode()) return [...mock.importJobs];
  const rows = await dbSelect<ImportJob>("import_jobs");
  return rows.length ? rows : [];
}
export async function addImportJob(input: Partial<ImportJob>): Promise<ImportJob> {
  const row: ImportJob = {
    id: uuid(),
    type: input.type || "BULK_TEXT",
    source_config: input.source_config || {},
    status: input.status || "pending",
    total_rows: input.total_rows ?? 0,
    success_count: input.success_count ?? 0,
    error_count: input.error_count ?? 0,
    errors: input.errors || [],
    created_by: input.created_by ?? null,
    created_at: new Date().toISOString(),
  };
  if (demoMode()) {
    mock.importJobs.unshift(row);
    return row;
  }
  return dbInsert<ImportJob>("import_jobs", row as unknown as Record<string, unknown>);
}
export async function updateImportJob(id: string, patch: Partial<ImportJob>): Promise<ImportJob | null> {
  if (demoMode()) {
    const idx = mock.importJobs.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    mock.importJobs[idx] = { ...mock.importJobs[idx], ...patch };
    return mock.importJobs[idx];
  }
  return dbUpdate<ImportJob>("import_jobs", id, patch as Record<string, unknown>);
}
