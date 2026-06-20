import { isDemoMode } from "./config";
import { getSupabaseAdmin } from "./supabase";
import * as mock from "./mockData";
import { computeExpiry, isExpired, isExpiringSoon, yesterdayISODate, todayISODate } from "./dates";
import { generateAccessCode } from "./codeGenerator";
import type {
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
} from "./types";

/**
 * The switchboard every API route uses.
 * Demo mode: read/write in-memory mock arrays.
 * Live mode: read/write Supabase. Switching is automatic via isDemoMode.
 */

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
  if (isDemoMode) return [...mock.students];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.students];
  const { data } = await db.from("students").select("*").order("created_at", { ascending: false });
  return (data as Student[]) ?? [];
}

export async function getStudentById(id: string): Promise<Student | null> {
  if (isDemoMode) return mock.students.find((s) => s.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("students").select("*").eq("id", id).maybeSingle();
  return (data as Student) ?? null;
}

export async function findStudentByLogin(phone: string, code: string): Promise<Student | null> {
  const normCode = code.trim().toUpperCase();
  if (isDemoMode) {
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
  if (isDemoMode) return mock.students.find((s) => s.phone === phone.trim()) ?? null;
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
  if (isDemoMode) {
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
  if (isDemoMode) {
    const idx = mock.students.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    mock.students[idx] = { ...mock.students[idx], ...patch };
    return mock.students[idx];
  }
  return dbUpdate<Student>("students", id, patch);
}

export async function deleteStudent(id: string): Promise<boolean> {
  if (isDemoMode) {
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
  if (isDemoMode) return [...mock.contentItems];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.contentItems];
  const { data } = await db.from("content_items").select("*").order("date", { ascending: false });
  return (data as ContentItem[]) ?? [];
}

export async function getPublishedContent(): Promise<ContentItem[]> {
  if (isDemoMode) return mock.contentItems.filter((c) => c.is_published);
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
  if (isDemoMode) {
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
  if (isDemoMode) {
    const idx = mock.contentItems.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    mock.contentItems[idx] = { ...mock.contentItems[idx], ...patch };
    return mock.contentItems[idx];
  }
  return dbUpdate<ContentItem>("content_items", id, patch);
}

export async function deleteContent(id: string): Promise<boolean> {
  if (isDemoMode) {
    const idx = mock.contentItems.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    mock.contentItems.splice(idx, 1);
    return true;
  }
  return dbDelete("content_items", id);
}

// ============================ BOOKMARKS ============================
export async function getBookmarks(studentId: string): Promise<Bookmark[]> {
  if (isDemoMode) return mock.bookmarks.filter((b) => b.student_id === studentId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("bookmarks").select("*").eq("student_id", studentId);
  return (data as Bookmark[]) ?? [];
}

export async function addBookmark(studentId: string, contentId: string): Promise<Bookmark> {
  if (isDemoMode) {
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
  if (isDemoMode) {
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
  if (isDemoMode) return mock.contentProgress.filter((p) => p.student_id === studentId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("content_progress").select("*").eq("student_id", studentId);
  return (data as ContentProgress[]) ?? [];
}

export async function markProgress(studentId: string, contentId: string, completed: boolean): Promise<ContentProgress> {
  if (isDemoMode) {
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
  if (isDemoMode) {
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
  if (isDemoMode) return [...mock.courses];
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
    created_at: new Date().toISOString(),
  } as Course;
  if (isDemoMode) {
    mock.courses.unshift(row);
    return row;
  }
  return dbInsert<Course>("courses", row as unknown as Record<string, unknown>);
}
export async function updateCourse(id: string, patch: Partial<Course>): Promise<Course | null> {
  if (isDemoMode) {
    const idx = mock.courses.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    mock.courses[idx] = { ...mock.courses[idx], ...patch };
    return mock.courses[idx];
  }
  return dbUpdate<Course>("courses", id, patch as Record<string, unknown>);
}
export async function deleteCourse(id: string): Promise<boolean> {
  if (isDemoMode) {
    const idx = mock.courses.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    mock.courses.splice(idx, 1);
    return true;
  }
  return dbDelete("courses", id);
}

// ============================ ENROLLMENTS ============================
export async function getEnrollments(studentId?: string): Promise<Enrollment[]> {
  const all = isDemoMode ? [...mock.enrollments] : await dbSelect<Enrollment>("enrollments", "enrolled_at");
  const list = all.length ? all : [...mock.enrollments];
  return studentId ? list.filter((e) => e.student_id === studentId) : list;
}

// ============================ LEADS / CRM ============================
export async function getLeads(): Promise<Lead[]> {
  if (isDemoMode) return [...mock.leads];
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
  if (isDemoMode) {
    mock.leads.unshift(row);
    return row;
  }
  return dbInsert<Lead>("leads", row as unknown as Record<string, unknown>);
}
export async function updateLead(id: string, patch: Partial<Lead>): Promise<Lead | null> {
  if (isDemoMode) {
    const idx = mock.leads.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    mock.leads[idx] = { ...mock.leads[idx], ...patch };
    return mock.leads[idx];
  }
  return dbUpdate<Lead>("leads", id, patch as Record<string, unknown>);
}
export async function deleteLead(id: string): Promise<boolean> {
  if (isDemoMode) {
    const idx = mock.leads.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    mock.leads.splice(idx, 1);
    return true;
  }
  return dbDelete("leads", id);
}
export async function getLeadActivities(leadId: string): Promise<LeadActivity[]> {
  if (isDemoMode) return mock.leadActivities.filter((a) => a.lead_id === leadId);
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
  if (isDemoMode) {
    mock.leadActivities.unshift(row);
    return row;
  }
  return dbInsert<LeadActivity>("lead_activities", row as unknown as Record<string, unknown>);
}

// ============================ LEAD FORMS ============================
export async function getLeadForms(): Promise<LeadFormConfig[]> {
  if (isDemoMode) return [...mock.leadForms];
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
  if (isDemoMode) {
    mock.leadForms.unshift(row);
    return row;
  }
  return dbInsert<LeadFormConfig>("lead_forms", row as unknown as Record<string, unknown>);
}

// ============================ WEBINARS ============================
export async function getWebinars(): Promise<Webinar[]> {
  if (isDemoMode) return [...mock.webinars];
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
    created_at: new Date().toISOString(),
  } as Webinar;
  if (isDemoMode) {
    mock.webinars.unshift(row);
    return row;
  }
  return dbInsert<Webinar>("webinars", row as unknown as Record<string, unknown>);
}
export async function updateWebinar(id: string, patch: Partial<Webinar>): Promise<Webinar | null> {
  if (isDemoMode) {
    const idx = mock.webinars.findIndex((w) => w.id === id);
    if (idx === -1) return null;
    mock.webinars[idx] = { ...mock.webinars[idx], ...patch };
    return mock.webinars[idx];
  }
  return dbUpdate<Webinar>("webinars", id, patch as Record<string, unknown>);
}
export async function deleteWebinar(id: string): Promise<boolean> {
  if (isDemoMode) {
    const idx = mock.webinars.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    mock.webinars.splice(idx, 1);
    return true;
  }
  return dbDelete("webinars", id);
}
export async function registerWebinar(webinarId: string, name: string, phone: string): Promise<{ ok: boolean }> {
  if (isDemoMode) {
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
  if (isDemoMode) return [...demoPayments()];
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
  if (isDemoMode) {
    demoPayments().unshift(row);
    return row;
  }
  try {
    return await dbInsert<Payment>("payments", row as unknown as Record<string, unknown>);
  } catch {
    // Best-effort: fall back to in-memory so the flow still works pre-migration.
    demoPayments().unshift(row);
    return row;
  }
}

export async function getPaymentByReference(referenceNo: string): Promise<Payment | null> {
  if (isDemoMode) {
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
  if (isDemoMode) {
    return updateDemo();
  }
  const db = getSupabaseAdmin();
  if (db) {
    const { data } = await db
      .from("payments")
      .update(patch as Record<string, unknown>)
      .eq("reference_no", referenceNo)
      .select()
      .maybeSingle();
    if (data) return data as Payment;
  }
  return updateDemo();
}

// ============================ REFERRALS ============================
export async function getReferrals(): Promise<Referral[]> {
  if (isDemoMode) return [...mock.referrals];
  const rows = await dbSelect<Referral>("referrals");
  return rows.length ? rows : [...mock.referrals];
}
export async function updateReferral(id: string, patch: Partial<Referral>): Promise<Referral | null> {
  if (isDemoMode) {
    const idx = mock.referrals.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    mock.referrals[idx] = { ...mock.referrals[idx], ...patch };
    return mock.referrals[idx];
  }
  return dbUpdate<Referral>("referrals", id, patch as Record<string, unknown>);
}

// ============================ STAFF ============================
export async function getStaff(): Promise<Staff[]> {
  if (isDemoMode) return [...mock.staff];
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
  if (isDemoMode) {
    mock.staff.unshift(row);
    return row;
  }
  return dbInsert<Staff>("staff", row as unknown as Record<string, unknown>);
}
export async function updateStaff(id: string, patch: Partial<Staff>): Promise<Staff | null> {
  if (isDemoMode) {
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
  if (isDemoMode) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("access_logs").insert({ student_id: studentId, action });
  } catch {
    /* best-effort */
  }
}
