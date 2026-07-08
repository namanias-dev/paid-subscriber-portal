/**
 * READ-ONLY Excel report for the "Saarthi (Old)" legacy import.
 * (Cloned from generate-safalta-report.ts — that script is left UNTOUCHED.)
 *
 * Sheet 1 "Imported Students"      — read back from the LIVE DB (post payment-
 *                                    reconciliation fix), one row per enrollment.
 * Sheet 2 "NOT Imported (Staff Action)" — the held rows, from the SOURCE sheet.
 * Sheet 3 "Staff Instructions"     — step-by-step manual-enrollment guide based on
 *                                    the ACTUAL admin portal flow.
 *
 * Writes NOTHING to the DB. Only reads, and writes ONE .xlsx to disk.
 *   node --env-file=.env.local --import tsx scripts/generate-saarthi-report.ts
 */
import * as os from "os";
import * as path from "path";
import * as xlsx from "xlsx";
import {
  getCourseBySlug,
  getAllCourseEnrollments,
  getBuyerByPhone,
} from "../lib/dataProvider";
import { deriveEnrollment, isLineOutstanding } from "../lib/installments";
import { formatINR, formatISTDate } from "../lib/dates";
import type { CourseEnrollment, InstallmentItem } from "../lib/types";

const COURSE_SLUG = "saarthi-old";
const SOURCE_XLSX = path.join(os.homedir(), "Downloads", "Old batches SAARTHI.xlsx");
const OUT_XLSX = path.join(os.homedir(), "Downloads", "Saarthi-Old-Import-Report.xlsx");

// SAARTHI sheet column headers (differ from Safalta).
const COLS = {
  name: "Student Name",
  mode: "Mode",
  batch: "Batch",
  phone: "Mobile Number",
  total: "Total Course Fee",
  paid: "Total fee received",
  pending: "Pending fee",
} as const;

// Valid Mode × Batch — must mirror the import's allowed-set guard.
const ALLOWED_MODES = new Set(["Online", "Offline"]);
const ALLOWED_TIMINGS = new Set(["Morning", "Evening"]);

// SAARTHI has NO name-mismatch identity conflicts (verified vs live DB).
const HELD_IDENTITY: Record<string, { sheetName: string; existing: string }> = {};

// ------------------------------- helpers ---------------------------------
function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[₹,\s]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}
function digits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}
function titleCase(s: string): string {
  const t = s.trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
function splitBatchLabel(label: string | null | undefined): { mode: string; batch: string } {
  const s = String(label ?? "").trim();
  if (!s) return { mode: "", batch: "" };
  const parts = s.split("·").map((x) => x.trim());
  if (parts.length >= 2) return { mode: parts[0], batch: parts.slice(1).join(" · ") };
  return { mode: s, batch: "" };
}
function outstandingInstallmentCount(schedule: InstallmentItem[]): number {
  return schedule.filter((s) => s.kind === "installment" && isLineOutstanding(s)).length;
}

// ------------------------- source sheet (held) ---------------------------
interface RawRow {
  name: string; mode: string; batch: string; phone: string;
  total: number; paid: number; pending: number;
}
function parseSource(): RawRow[] {
  const wb = xlsx.readFile(SOURCE_XLSX);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
  return json.map((r) => ({
    name: String(r[COLS.name] ?? "").trim(),
    mode: titleCase(String(r[COLS.mode] ?? "")),
    batch: titleCase(String(r[COLS.batch] ?? "")),
    phone: digits(r[COLS.phone]),
    total: toNum(r[COLS.total]),
    paid: toNum(r[COLS.paid]),
    pending: toNum(r[COLS.pending]),
  }));
}
function deriveStickers(rows: RawRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!ALLOWED_MODES.has(r.mode) || !ALLOWED_TIMINGS.has(r.batch)) continue;
    const k = `${r.mode}|${r.batch}`;
    m.set(k, Math.max(m.get(k) ?? 0, r.total));
  }
  return m;
}

// --------------------------------- main ----------------------------------
async function main() {
  console.log("Reading live DB…");
  const course = await getCourseBySlug(COURSE_SLUG);
  if (!course) throw new Error(`Legacy course "${COURSE_SLUG}" not found in DB.`);
  const allEnr = await getAllCourseEnrollments();
  const enrollments = allEnr
    .filter((e) => e.course_id === course.id && e.status !== "cancelled")
    .sort((a, b) => {
      const bl = (a.batch_label || "").localeCompare(b.batch_label || "");
      return bl !== 0 ? bl : (a.student_name || "").localeCompare(b.student_name || "");
    });
  console.log(`  Course: ${course.title}  (default price ${formatINR(course.price)})`);
  console.log(`  Active enrollments: ${enrollments.length}`);

  // ---- Sheet 1: Imported Students (live DB) ----
  const s1Header = [
    "Sr.No", "Name", "Mobile", "Course", "Mode", "Batch",
    "Sticker Fee", "Discount", "Effective Total", "Total Paid", "Outstanding",
    "Installments Remaining", "Next Due", "Access (Full/Installments)", "LOGIN CODE",
  ];
  const s1Rows: (string | number)[][] = [];
  let tEff = 0, tPaid = 0, tOut = 0;
  let egeshPaid = -1;
  for (let i = 0; i < enrollments.length; i++) {
    const e = enrollments[i] as CourseEnrollment;
    const d = deriveEnrollment(e);
    const schedule = e.schedule || [];
    const discount = e.discount_amount ?? 0;
    const sticker = e.original_total_fee ?? (e.total_fee + discount);
    const effective = e.total_fee;
    const paid = d.paid;
    const outstanding = d.remaining;
    const instRem = outstandingInstallmentCount(schedule);
    const next = d.nextPayable;
    const nextDue = next ? `${formatINR(next.amount)}${next.due ? ` on ${formatISTDate(next.due)}` : ""}` : "—";
    const access = outstanding <= 0 ? "Full" : "Installments";
    const { mode, batch } = splitBatchLabel(e.batch_label);
    const buyer = await getBuyerByPhone(e.phone).catch(() => null);
    const code = buyer?.login_code ?? "—";
    if (e.phone === "7354132216") egeshPaid = paid;
    tEff += effective; tPaid += paid; tOut += outstanding;
    s1Rows.push([
      i + 1, e.student_name || "", e.phone || "", course.title, mode, batch,
      sticker, discount, effective, paid, outstanding,
      instRem, nextDue, access, code,
    ]);
  }
  const s1Totals = ["", "TOTAL", "", "", "", "", "", "", tEff, tPaid, tOut, "", "", "", ""];
  const s1 = [s1Header, ...s1Rows, [], s1Totals];

  // ---- Sheet 2: NOT Imported (held) — from source sheet ----
  const src = parseSource();
  const stickers = deriveStickers(src);
  const validPhones = src.filter((r) => /^\d{10}$/.test(r.phone));
  const phoneCounts = new Map<string, number>();
  for (const r of validPhones) phoneCounts.set(r.phone, (phoneCounts.get(r.phone) ?? 0) + 1);

  // Held set MUST mirror the import script's holds: duplicate mobile, identity
  // conflict, malformed Mode/Batch (allowed-set guard), and balance mismatch
  // (Paid + Pending ≠ Total).
  const isDup = (r: RawRow) => (phoneCounts.get(r.phone) ?? 0) > 1;
  const isBadCombo = (r: RawRow) => !ALLOWED_MODES.has(r.mode) || !ALLOWED_TIMINGS.has(r.batch);
  const isBalanceOff = (r: RawRow) => r.paid + r.pending !== r.total;
  const heldRows = src.filter((r) => isDup(r) || HELD_IDENTITY[r.phone] || isBadCombo(r) || isBalanceOff(r));
  const s2Header = [
    "Name (per sheet)", "Mobile", "Intended Course / Mode / Batch",
    "Sticker", "Effective Total (per sheet)", "Reason Not Imported", "Conflict Detail", "Action Required",
  ];
  const s2Rows = heldRows.map((r) => {
    const sticker = stickers.get(`${r.mode}|${r.batch}`) ?? r.total;
    const intended = `${course.title} · ${r.mode} · ${r.batch}`;
    let reason: string, conflict: string, action: string;
    if (isDup(r)) {
      const others = validPhones.filter((x) => x.phone === r.phone && x.name !== r.name).map((x) => x.name);
      reason = "Duplicate mobile — one number shared by two different students in the sheet.";
      conflict = `Mobile ${r.phone} is also listed for: ${others.join(", ") || "another student"}. We cannot tell which person the number really belongs to, and one login code cannot serve two students.`;
      action = "Call both students. Get a separate, distinct 10-digit mobile for EACH. Then enroll each one manually (Sheet 3).";
    } else if (HELD_IDENTITY[r.phone]) {
      const h = HELD_IDENTITY[r.phone];
      reason = "Phone already belongs to a DIFFERENT existing portal account (name mismatch).";
      conflict = `Sheet name "${h.sheetName}" but the account on ${r.phone} is "${h.existing}". Importing would attach the course to the wrong person.`;
      action = `Call to confirm the real owner of ${r.phone}. If wrong number, get the student's correct mobile. Then enroll manually (Sheet 3).`;
    } else if (isBadCombo(r)) {
      reason = "Invalid Mode/Batch in the sheet — cannot place into a real batch.";
      conflict = `Sheet lists Mode "${r.mode || "(blank)"}" · Batch "${r.batch || "(blank)"}". Allowed: Mode ∈ {Online, Offline}, Batch ∈ {Morning, Evening}.`;
      action = "Confirm the correct Mode and Batch with staff, then enroll manually (Sheet 3).";
    } else {
      reason = "Fee figures don't add up — Paid + Pending ≠ Total.";
      conflict = `Paid ₹${r.paid.toLocaleString("en-IN")} + Pending ₹${r.pending.toLocaleString("en-IN")} ≠ Total ₹${r.total.toLocaleString("en-IN")}. Held so no wrong balance is created.`;
      action = "Verify the correct fee figures with staff, then enroll manually (Sheet 3).";
    }
    return [r.name, r.phone, intended, sticker, r.total, reason, conflict, action];
  });
  const s2 = [s2Header, ...s2Rows];

  // ---- Sheet 3: Staff Instructions ----
  const s3 = buildStaffInstructions(course.title, heldRows, stickers);

  // ---- write workbook ----
  const wb = xlsx.utils.book_new();
  const ws1 = xlsx.utils.aoa_to_sheet(s1);
  ws1["!cols"] = [
    { wch: 6 }, { wch: 22 }, { wch: 12 }, { wch: 22 }, { wch: 9 }, { wch: 10 },
    { wch: 11 }, { wch: 10 }, { wch: 13 }, { wch: 11 }, { wch: 11 },
    { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 13 },
  ];
  xlsx.utils.book_append_sheet(wb, ws1, "Imported Students");

  const ws2 = xlsx.utils.aoa_to_sheet(s2);
  ws2["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 34 }, { wch: 10 }, { wch: 14 }, { wch: 42 }, { wch: 54 }, { wch: 56 }];
  xlsx.utils.book_append_sheet(wb, ws2, "NOT Imported (Staff Action)");

  const ws3 = xlsx.utils.aoa_to_sheet(s3);
  ws3["!cols"] = [{ wch: 4 }, { wch: 120 }];
  xlsx.utils.book_append_sheet(wb, ws3, "Staff Instructions");

  xlsx.writeFile(wb, OUT_XLSX);

  // ---- console summary ----
  console.log("");
  console.log(`Egesh (7354132216) Total Paid read from DB: ${egeshPaid >= 0 ? formatINR(egeshPaid) : "NOT FOUND"}`);
  console.log(`Sheet 1 totals — Effective ${formatINR(tEff)} · Paid ${formatINR(tPaid)} · Outstanding ${formatINR(tOut)}`);
  console.log(`Sheet 1 check: Paid + Outstanding = ${formatINR(tPaid + tOut)} ${tPaid + tOut === tEff ? "= Effective ✓" : "≠ Effective ✗"}`);
  console.log(`Sheet 2 held rows: ${heldRows.length}`);
  console.log("");
  console.log(`Saved: ${OUT_XLSX}`);
}

function buildStaffInstructions(courseTitle: string, held: RawRow[], stickers: Map<string, number>): (string | number)[][] {
  const L: (string | number)[][] = [];
  const line = (a = "", b = "") => L.push([a, b]);
  line("Saarthi (Old) — Staff Instructions (manual enrollment of held students)");
  line("");
  line("", `This guide is for ${held.length} students who could NOT be auto-imported. Read Sheet 2 for the reason each was held.`);
  line("", "Do these steps in the ADMIN PORTAL. Anything in \"quotes\" is the exact button/label you will see on screen.");
  line("");
  line("STEP 0", "Fix the data for each held student FIRST (see Sheet 2 for the exact reason each was held).");
  line("", "• Balance mismatch (Rakesh, Harleen, Daksh): Paid + Pending did not equal the Total on the sheet.");
  line("", "  Confirm the correct Total / Paid / Pending figures with accounts before enrolling.");
  line("", "• Invalid Mode/Batch (Abhishek, Anjali): the sheet's Mode/Batch was not a real batch.");
  line("", "  Confirm the correct Mode (Online/Offline) and Batch (Morning/Evening), then enroll into that batch.");
  line("", "• If any held student shares a mobile with another, get a separate, distinct 10-digit number for each first.");
  line("");
  line("STEP 1", "Make the batch course selectable (it is normally hidden from students).");
  line("", "• Left sidebar → \"Courses\" (🎓, under Academics).");
  line("", `• Open \"${courseTitle}\".`);
  line("", "• On the \"Basic Details\" tab, change \"Status\" from \"Draft (hidden)\" to \"Published (live)\".");
  line("", "• Click \"Save Changes\". (You will set it back to Draft in STEP 6.)");
  line("");
  line("STEP 2", "Create the student profile.");
  line("", "• Left sidebar → \"Students & Enrollments\" (👨‍🎓, under People) → \"Add student\".");
  line("", "• Fill \"Full name\" and \"Phone (10-digit)\" (use the CORRECT number from STEP 0). Email is optional.");
  line("", "• Under \"Enroll into courses\", tick the box for the batch course, and choose the plan:");
  line("", "     – \"Pay in full\" if the student has NO pending amount.");
  line("", "     – \"EMI / Installments\" if money is still pending (pick any installment count for now; you fix it in STEP 4).");
  line("", "• (Optional) Under \"Record initial payment\" you may skip for now — we record the exact paid amount in STEP 5.");
  line("", "• In \"Internal notes\" type the intended Mode & Batch (e.g. \"Online · Morning\") — the enroll form has no batch picker.");
  line("", "• Click \"Create student\". The screen shows a LOGIN CODE — copy it and give it to the student.");
  line("");
  line("STEP 3", "Set the correct EFFECTIVE fee (apply the negotiated discount).");
  line("", "• Click \"Open profile →\" (or open the student from \"Students & Enrollments\").");
  line("", "• Find the course under \"Active enrolled courses\" → click \"Discount\".");
  line("", "• Type a discount amount and watch the \"New total\" figure. Adjust it until \"New total\" equals the");
  line("", "  \"Effective Total\" shown in the cheat-sheet below. Add a reason (e.g. \"Legacy June 2026 negotiated fee\").");
  line("", "• Click \"Apply … discount\". (If the student had no discount, i.e. Effective = Sticker, skip this step.)");
  line("");
  line("STEP 4", "Set the number of remaining installments (EMI students only).");
  line("", "• On the course card click \"Change plan\" → choose \"EMI\" → set the number of installments from the cheat sheet,");
  line("", "  or choose \"Custom (staff)\" to type exact amounts and due dates. Save.");
  line("", "• Use \"Manage installments\" to fine-tune any due date if needed. (Full-payment students: skip this step.)");
  line("");
  line("STEP 5", "Record the amount ALREADY paid so \"Total Paid\" is correct.");
  line("", "• On the course card click \"Record payment\".");
  line("", "• Choose the line(s) to settle (or \"Pay full remaining balance\"), pick a \"Method\" (Cash / Bank Transfer / Offline UPI),");
  line("", "  set the \"Date\" it was actually paid, and add a note (e.g. old receipt no.).");
  line("", "• Click \"Record …\". Enter amounts so the running \"Paid so far\" matches the \"Amount Paid\" in the cheat sheet.");
  line("");
  line("STEP 6", "Verify, then re-hide the course.");
  line("", "• On the student's profile, check the top tiles: \"Total paid\" and \"Outstanding\" must match the cheat sheet.");
  line("", "• Confirm the \"Portal\" login code is shown in the profile header (that is the code the student logs in with).");
  line("", "• Go back to \"Courses\" → open the batch course → set \"Status\" back to \"Draft (hidden)\" → \"Save Changes\".");
  line("");
  line("HOW TO VERIFY THE LOGIN CODE WORKS", "");
  line("", "• The code appears (a) on the \"Student created\" screen and (b) on the profile header next to \"Portal\".");
  line("", "• The student signs in at the portal login page using that code. If lost, reopen the profile to read it again.");
  line("");
  line("PER-STUDENT CHEAT-SHEET (enter these values — do not recalculate)", "");
  L.push(["", ["Name", "Correct Mobile", "Batch (Mode·Timing)", "Sticker", "Discount to apply", "Effective Total", "Amount Paid", "Installments (pending)"].join("  |  ")]);
  for (const r of held) {
    const sticker = stickers.get(`${r.mode}|${r.batch}`) ?? r.total;
    const discount = Math.max(0, sticker - r.total);
    const phoneNote = HELD_IDENTITY[r.phone] || (r.phone === "9595264646") ? "GET NEW NUMBER" : r.phone;
    const instPending = r.pending > 0 ? "as per old plan (see notes)" : "0 (fully paid)";
    L.push(["", [
      r.name,
      phoneNote,
      `${r.mode} · ${r.batch}`,
      formatINR(sticker),
      discount > 0 ? formatINR(discount) : "none",
      formatINR(r.total),
      formatINR(r.paid),
      instPending,
    ].join("  |  ")]);
  }
  line("");
  line("NOTE", "The enroll form has no Mode×Batch selector, so record the batch in \"Internal notes\". Fees/discount/paid are exact.");
  return L;
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
