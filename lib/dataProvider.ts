import { isDemoMode } from "./config";
import { getSupabaseAdmin } from "./supabase";
import * as mock from "./mockData";
import { computeExpiry, isExpired, isExpiringSoon, yesterdayISODate, todayISODate } from "./dates";
import { generateAccessCode } from "./codeGenerator";
import type { Student, ContentItem, Bookmark, ContentProgress, PlanId } from "./types";

/**
 * The switchboard. Every API route talks to these functions.
 * In demo mode they read/write in-memory mock arrays.
 * In live mode they read/write Supabase. Switching is automatic.
 */

function uuid(): string {
  // crypto.randomUUID is available in Node 18+ and the edge runtime.
  try {
    return crypto.randomUUID();
  } catch {
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

// ----------------------------- STUDENTS -----------------------------

export async function getStudents(): Promise<Student[]> {
  if (isDemoMode) return [...mock.students];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.students];
  const { data } = await db
    .from("students")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as Student[]) ?? [];
}

export async function getStudentById(id: string): Promise<Student | null> {
  if (isDemoMode) return mock.students.find((s) => s.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return mock.students.find((s) => s.id === id) ?? null;
  const { data } = await db.from("students").select("*").eq("id", id).maybeSingle();
  return (data as Student) ?? null;
}

export async function findStudentByLogin(
  phone: string,
  code: string
): Promise<Student | null> {
  const normCode = code.trim().toUpperCase();
  if (isDemoMode) {
    return (
      mock.students.find(
        (s) => s.phone === phone.trim() && s.access_code === normCode && s.is_active
      ) ?? null
    );
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
  const { data } = await db
    .from("students")
    .select("*")
    .eq("phone", phone.trim())
    .maybeSingle();
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

export async function updateStudent(
  id: string,
  patch: Partial<Student>
): Promise<Student | null> {
  if (isDemoMode) {
    const idx = mock.students.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    mock.students[idx] = { ...mock.students[idx], ...patch };
    return mock.students[idx];
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("students").update(patch).eq("id", id).select().single();
  return (data as Student) ?? null;
}

export async function deleteStudent(id: string): Promise<boolean> {
  if (isDemoMode) {
    const idx = mock.students.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    mock.students.splice(idx, 1);
    return true;
  }
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.from("students").delete().eq("id", id);
  return !error;
}

/** Bump streak on login: +1 if last active yesterday, reset to 1 if gap, keep if today. */
export async function touchStreakOnLogin(student: Student): Promise<Student> {
  const today = todayISODate();
  const yesterday = yesterdayISODate();
  let streak = student.streak_count || 0;
  if (student.last_active_date === today) {
    // already counted today
  } else if (student.last_active_date === yesterday) {
    streak += 1;
  } else {
    streak = 1;
  }
  const updated = await updateStudent(student.id, {
    streak_count: streak,
    last_active_date: today,
  });
  return updated ?? { ...student, streak_count: streak, last_active_date: today };
}

// ----------------------------- CONTENT -----------------------------

export async function getAllContent(): Promise<ContentItem[]> {
  if (isDemoMode) return [...mock.contentItems];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.contentItems];
  const { data } = await db
    .from("content_items")
    .select("*")
    .order("date", { ascending: false });
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
  type: ContentItem["type"];
  subject?: string | null;
  paper?: string | null;
  title: string;
  description?: string | null;
  drive_link?: string | null;
  youtube_link?: string | null;
  date?: string | null;
  duration?: string | null;
  is_published?: boolean;
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

export async function updateContent(
  id: string,
  patch: Partial<ContentItem>
): Promise<ContentItem | null> {
  if (isDemoMode) {
    const idx = mock.contentItems.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    mock.contentItems[idx] = { ...mock.contentItems[idx], ...patch };
    return mock.contentItems[idx];
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("content_items")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return (data as ContentItem) ?? null;
}

export async function deleteContent(id: string): Promise<boolean> {
  if (isDemoMode) {
    const idx = mock.contentItems.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    mock.contentItems.splice(idx, 1);
    return true;
  }
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.from("content_items").delete().eq("id", id);
  return !error;
}

// ----------------------------- BOOKMARKS -----------------------------

export async function getBookmarks(studentId: string): Promise<Bookmark[]> {
  if (isDemoMode) return mock.bookmarks.filter((b) => b.student_id === studentId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("bookmarks").select("*").eq("student_id", studentId);
  return (data as Bookmark[]) ?? [];
}

export async function addBookmark(
  studentId: string,
  contentId: string
): Promise<Bookmark> {
  const existing = mock.bookmarks.find(
    (b) => b.student_id === studentId && b.content_id === contentId
  );
  if (isDemoMode) {
    if (existing) return existing;
    const row: Bookmark = {
      id: uuid(),
      student_id: studentId,
      content_id: contentId,
      created_at: new Date().toISOString(),
    };
    mock.bookmarks.push(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const { data, error } = await db
    .from("bookmarks")
    .insert({ student_id: studentId, content_id: contentId })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Bookmark;
}

export async function removeBookmark(
  studentId: string,
  contentId: string
): Promise<boolean> {
  if (isDemoMode) {
    const idx = mock.bookmarks.findIndex(
      (b) => b.student_id === studentId && b.content_id === contentId
    );
    if (idx === -1) return false;
    mock.bookmarks.splice(idx, 1);
    return true;
  }
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db
    .from("bookmarks")
    .delete()
    .eq("student_id", studentId)
    .eq("content_id", contentId);
  return !error;
}

// ----------------------------- PROGRESS -----------------------------

export async function getProgress(studentId: string): Promise<ContentProgress[]> {
  if (isDemoMode) return mock.contentProgress.filter((p) => p.student_id === studentId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("content_progress")
    .select("*")
    .eq("student_id", studentId);
  return (data as ContentProgress[]) ?? [];
}

export async function markProgress(
  studentId: string,
  contentId: string,
  completed: boolean
): Promise<ContentProgress> {
  if (isDemoMode) {
    const existing = mock.contentProgress.find(
      (p) => p.student_id === studentId && p.content_id === contentId
    );
    if (existing) {
      existing.completed = completed;
      existing.completed_at = completed ? new Date().toISOString() : null;
      return existing;
    }
    const row: ContentProgress = {
      id: uuid(),
      student_id: studentId,
      content_id: contentId,
      completed,
      completed_at: completed ? new Date().toISOString() : null,
    };
    mock.contentProgress.push(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const { data, error } = await db
    .from("content_progress")
    .upsert(
      {
        student_id: studentId,
        content_id: contentId,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      },
      { onConflict: "student_id,content_id" }
    )
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ContentProgress;
}

// ----------------------------- ADMIN -----------------------------

export async function verifyAdminCredentials(
  username: string,
  password: string
): Promise<{ id: string; username: string } | null> {
  if (isDemoMode) {
    const admin = mock.adminUsers.find((a) => a.username === username);
    if (admin && admin.plaintext_password === password) {
      return { id: admin.id, username: admin.username };
    }
    return null;
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("admin_users")
    .select("*")
    .eq("username", username)
    .maybeSingle();
  if (!data) return null;
  const bcrypt = await import("bcryptjs");
  const ok = await bcrypt.compare(password, (data as { password_hash: string }).password_hash);
  if (!ok) return null;
  return { id: (data as { id: string }).id, username };
}

// ----------------------------- STATS -----------------------------

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

// ----------------------------- ACCESS LOGS -----------------------------

export async function logAccess(studentId: string | null, action: string): Promise<void> {
  if (isDemoMode) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("access_logs").insert({ student_id: studentId, action });
  } catch {
    // best-effort logging; never block the request
  }
}
