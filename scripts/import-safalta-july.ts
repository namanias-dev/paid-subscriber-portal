/**
 * ONE-TIME legacy/pre-portal backfill — "Safalta July Batch" (starts 13 Jul 2026).
 *
 * Cloned from import-safalta-june.ts / import-saarthi.ts (those proven scripts are
 * left UNTOUCHED). JULY-specific differences vs June/Saarthi:
 *   • ADDITIVE enroll into TWO PRE-EXISTING courses (resolved read-only by slug/id):
 *       - ONLINE  → co-safalta      (safalta-online-foundation)  price 45000 / orig 50000
 *       - OFFLINE → co-saarthi-off  (saarthi-gs-foundation-offline, the Chandigarh
 *                   offline course, user-confirmed) price 75000 / orig 100000
 *     This script NEVER creates or modifies a course (no addCourse). It ABORTS if
 *     either course is missing or its id doesn't match the expected id.
 *   • The row's ONLINE/OFFLINE course is chosen from the sheet's own `Mode` column.
 *   • Sticker (list price) is the FIXED course.price of the routed course — NOT
 *     derived from the sheet. Discount = sticker − negotiated total.
 *   • Outstanding installment due dates are keyed off the BATCH START (2026-07-13).
 *   • Per-row money gate (HARD STOP #2): a row whose Paid + Pending ≠ Total is HELD
 *     as an exception and NEVER committed; all clean rows still import.
 *
 * DRY-RUN by DEFAULT: writes NOTHING. Pass --commit to actually write.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/import-safalta-july.ts "<xlsx>"            # dry-run
 *   node --env-file=.env.local --import tsx scripts/import-safalta-july.ts "<xlsx>" --commit   # writes
 *
 * The --commit path uses the EXACT existing dataProvider functions
 * (ensureBuyer / addCourseEnrollment / applyEnrollmentDiscount) and requires
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the runtime env.
 *
 * Idempotent: re-runs detect an existing non-cancelled enrollment by phone ON THE
 * ROW'S TARGET COURSE and skip (never re-create, never re-apply a discount, never
 * re-mint a login code). It only ever touches these two target courses — never any
 * other student, and never a student already enrolled in them.
 */
import * as xlsx from "xlsx";
import {
  getCourseBySlug,
  ensureBuyer,
  getBuyerByPhone,
  addCourseEnrollment,
  getCourseEnrollmentsByPhone,
  applyEnrollmentDiscount,
} from "../lib/dataProvider";
import { getSupabaseAdmin } from "../lib/supabase";
import { addDaysISO, addMonthsISO, formatINR } from "../lib/dates";
import type { Course, CourseEnrollment, InstallmentItem } from "../lib/types";

// ------------------------------- constants -------------------------------
const BATCH_LABEL = "Safalta July Batch — starts 13 Jul 2026";
// Outstanding installment due dates are anchored to the batch start (IST midday).
const BATCH_START_ISO = new Date("2026-07-13T00:00:00+05:30").toISOString();
const DISCOUNT_REASON = "Safalta July 2026 negotiated fee";
const IMPORT_ACTOR = "legacy-import:safalta-july-2026";

/** The two PRE-EXISTING target courses (resolved read-only; never created/modified). */
const TARGETS = {
  Online: { slug: "safalta-online-foundation", id: "co-safalta", fallbackSticker: 45000 },
  Offline: { slug: "saarthi-gs-foundation-offline", id: "co-saarthi-off", fallbackSticker: 75000 },
} as const;
type Mode = keyof typeof TARGETS;

// Rounding tolerance: flag ONLY if the sheet's (count × each) deviates from
// pending by MORE than ₹1 per pending installment.
const ROUNDING_TOLERANCE_PER_INSTALLMENT = 1;

/**
 * Sheet column headers → internal fields. NOTE the July sheet has BOTH a
 * "Batch " (trailing space — the batch NAME) and a "Batch" (the timing) column.
 */
const COLS = {
  srNo: "Sr.No",
  name: "Name",
  mode: "Mode",
  timing: "Batch",
  batchName: "Batch ",
  status: "Status",
  phone: "Mobile number",
  actualTotal: "Total Course fee",
  paid: "Total Fee received",
  pending: "Pending Fee",
  nPending: "Number of Instaments pending",
  eachMonth: "Each month Installment amount",
} as const;

const ALLOWED_MODES = new Set<string>(["Online", "Offline"]);

/**
 * Phones explicitly HELD for staff action (NOT imported) — approved holds.
 * Empty for July (no pre-approved identity holds); the live-DB name-mismatch
 * heuristic (enrichFromDb) is the runtime identity guard.
 */
const HELD_IDENTITY_PHONES: Record<string, string> = {};

// EMI cadence for rebuilt due dates on outstanding installments.
const FIRST_INTERVAL_DAYS = 7;
const INTERVAL_MONTHS = 1;

// ------------------------------- helpers ---------------------------------
const NBSP = " ";
function money(n: number): string {
  return formatINR(Math.round(n));
}
function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[₹,\s]/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function digits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}
function titleCase(s: string): string {
  const t = s.trim().toLowerCase();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
/**
 * Heuristic: does the sheet name plausibly belong to the same person as an
 * existing buyer account on that phone? True when they're equal ignoring
 * case/spaces, one contains the other, or they share a first name. A FALSE
 * result means the phone is likely a different person → needs-review skip
 * (never attach a course to the wrong identity).
 */
function namesLikelySame(sheetName: string, buyerName: string | null | undefined): boolean {
  if (!buyerName) return true; // no existing account → nothing to conflict with
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s = norm(sheetName);
  const b = norm(buyerName);
  if (!s || !b) return true;
  if (s === b || b.includes(s) || s.includes(b)) return true;
  const firstS = sheetName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const firstB = buyerName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return !!firstS && firstS === firstB;
}
function pad(s: string, w: number): string {
  s = String(s);
  return s.length >= w ? s : s + NBSP.repeat(w - s.length);
}
function padL(s: string, w: number): string {
  s = String(s);
  return s.length >= w ? s : NBSP.repeat(w - s.length) + s;
}
function hr(ch = "─", w = 100): string {
  return ch.repeat(w);
}

// --------------------------- schedule builders ---------------------------
/** Outstanding installment lines that sum EXACTLY to `remaining` (last absorbs remainder). */
function buildOutstanding(remaining: number, count: number, baseISO: string): InstallmentItem[] {
  if (count <= 0 || remaining <= 0) return [];
  const base = Math.floor(remaining / count);
  const remainder = remaining - base * count;
  const firstDue = addDaysISO(baseISO, FIRST_INTERVAL_DAYS);
  const lines: InstallmentItem[] = [];
  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    lines.push({
      no: i + 1, // line 1 is the paid line; installments start at 2
      kind: "installment",
      label: `Installment ${i} of ${count}`,
      amount: base + (isLast ? remainder : 0),
      due: i === 1 ? firstDue : addMonthsISO(firstDue, (i - 1) * INTERVAL_MONTHS),
      paid: false,
      status: "pending",
    });
  }
  return lines;
}

/** The paid "legacy fee received" line (money already collected pre-portal). */
function paidLine(paid: number, nowISO: string): InstallmentItem {
  return {
    no: 1,
    kind: "installment",
    label: "Legacy fee received (pre-portal)",
    amount: paid,
    due: null,
    paid: true,
    status: "paid",
    paid_at: nowISO,
  };
}

// ------------------------------- types -----------------------------------
interface RawRow {
  rowNo: number; // 1-based data row (for messages)
  srNo: number;
  name: string;
  mode: string;
  timing: string;
  status: string;
  phone: string;
  actualTotal: number; // "Total Course fee" (negotiated per-student total)
  paid: number; // "Total Fee received"
  pending: number; // "Pending Fee"
  nPending: number; // "Number of Instaments pending"
  eachMonth: number; // "Each month Installment amount"
}

interface StudentPlan {
  raw: RawRow;
  mode: string;
  batchLabel: string;
  sticker: number;
  actualTotal: number;
  paid: number;
  pending: number;
  n: number;
  discount: number;
  scheduleFinal: InstallmentItem[]; // post-discount (what the student sees)
  scheduleAtSticker: InstallmentItem[]; // pre-discount (what commit creates first)
  status: "fully_paid" | "partially_paid";
  access: "Full" | "Installments";
  errors: string[]; // hard → skip (held as exceptions)
  flags: string[]; // soft → import + confirm
  roundingBefore?: number[];
  roundingAfter?: number[];
  skip: boolean;
  skipReason?: string;
  // filled at runtime from DB
  existingLoginCode?: string | null;
  existingBuyerName?: string | null;
  existingBuyerIsLead?: boolean;
  nameMismatch?: boolean;
  alreadyImported?: boolean;
}

// ------------------------------- parse -----------------------------------
function parseRows(path: string): RawRow[] {
  const wb = xlsx.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true });
  return json.map((r, i) => ({
    rowNo: i + 1,
    srNo: toNum(r[COLS.srNo]),
    name: String(r[COLS.name] ?? "").trim(),
    mode: titleCase(String(r[COLS.mode] ?? "")),
    timing: titleCase(String(r[COLS.timing] ?? "")),
    status: String(r[COLS.status] ?? "").trim(),
    phone: digits(r[COLS.phone]),
    actualTotal: toNum(r[COLS.actualTotal]),
    paid: toNum(r[COLS.paid]),
    pending: toNum(r[COLS.pending]),
    nPending: toNum(r[COLS.nPending]),
    eachMonth: toNum(r[COLS.eachMonth]),
  }));
}

// ----------------------------- planning ----------------------------------
function planStudent(r: RawRow, sticker: number, dupPhones: Set<string>, nowISO: string): StudentPlan {
  const batchLabel = BATCH_LABEL;
  const errors: string[] = [];
  const flags: string[] = [];

  // --- hard validations (→ held as exceptions) ---
  if (!r.name) errors.push("Missing student name.");
  if (!ALLOWED_MODES.has(r.mode)) {
    errors.push(`Mode "${r.mode || "(blank)"}" is not Online/Offline — cannot route to a course.`);
  }
  if (!/^\d{10}$/.test(r.phone)) errors.push(`Invalid mobile "${r.phone}" (need 10 digits).`);
  if (dupPhones.has(r.phone)) {
    errors.push("Duplicate mobile shared by 2+ students — staff must supply a distinct number.");
  }
  if (HELD_IDENTITY_PHONES[r.phone]) errors.push(HELD_IDENTITY_PHONES[r.phone]);
  if (r.actualTotal <= 0) errors.push("Total Course fee is 0/blank.");
  if (r.paid <= 0) errors.push("No amount paid — cannot grant access.");
  // HARD STOP #2 — money must reconcile exactly, else HOLD (never write wrong balances).
  if (r.paid + r.pending !== r.actualTotal) {
    errors.push(`Paid (${money(r.paid)}) + Pending (${money(r.pending)}) ≠ Total (${money(r.actualTotal)}).`);
  }
  if (sticker && r.actualTotal > sticker) {
    errors.push(`Negotiated total (${money(r.actualTotal)}) exceeds course sticker (${money(sticker)}).`);
  }

  // --- soft flags (→ import + confirm) ---
  if (!r.status) flags.push("Blank Status in sheet — status derived from figures; confirm with staff.");
  if (r.pending > 0 && r.nPending <= 0) flags.push(`Pending ${money(r.pending)} but 0 installments listed — treated as 1.`);
  if (r.pending === 0 && r.nPending > 0) flags.push("Fully paid but sheet lists pending installments — ignored.");

  // rounding check on the sheet's own figures (each × count vs pending)
  let roundingBefore: number[] | undefined;
  let roundingAfter: number[] | undefined;
  const n = r.pending > 0 ? Math.max(1, r.nPending) : 0;
  if (n > 0) {
    const sheetSum = r.eachMonth * r.nPending;
    const deviation = Math.abs(sheetSum - r.pending);
    if (deviation > 0) roundingBefore = Array.from({ length: r.nPending }, () => r.eachMonth);
    if (deviation > ROUNDING_TOLERANCE_PER_INSTALLMENT * Math.max(1, r.nPending)) {
      flags.push(`Sheet installment rounding off by ${money(deviation)} (> ₹1/installment) — rebuilt exactly.`);
    }
  }

  const discount = Math.max(0, sticker - r.actualTotal);

  // Final schedule (post-discount) — what the portal shows; matches applyEnrollmentDiscount output.
  const scheduleFinal: InstallmentItem[] = [paidLine(r.paid, nowISO), ...buildOutstanding(r.pending, n, BATCH_START_ISO)];
  // Pre-discount schedule (created first on commit, at sticker total).
  const scheduleAtSticker: InstallmentItem[] = [paidLine(r.paid, nowISO), ...buildOutstanding(sticker - r.paid, n, BATCH_START_ISO)];

  if (roundingBefore) roundingAfter = scheduleFinal.filter((s) => !s.paid).map((s) => s.amount);

  const status: "fully_paid" | "partially_paid" = r.pending <= 0 ? "fully_paid" : "partially_paid";
  const access: "Full" | "Installments" = r.pending <= 0 ? "Full" : "Installments";

  return {
    raw: r,
    mode: r.mode,
    batchLabel,
    sticker,
    actualTotal: r.actualTotal,
    paid: r.paid,
    pending: r.pending,
    n,
    discount,
    scheduleFinal,
    scheduleAtSticker,
    status,
    access,
    errors,
    flags,
    roundingBefore,
    roundingAfter,
    skip: errors.length > 0,
    skipReason: errors.length > 0 ? errors.join(" ") : undefined,
  };
}

// ------------------------------- report ----------------------------------
function printHeader(commit: boolean, dbConnected: boolean, xlsxPath: string) {
  console.log(hr("="));
  console.log(`  SAFALTA JULY BATCH — PRE-PORTAL BACKFILL   ${commit ? ">>> COMMIT (WRITES) <<<" : "DRY-RUN (writes nothing)"}`);
  console.log(hr("="));
  console.log(`  Source : ${xlsxPath}`);
  console.log(`  Batch  : ${BATCH_LABEL}`);
  console.log(`  DB     : ${dbConnected ? "connected (live Supabase)" : "NOT connected (financials computed from sheet only)"}`);
  console.log("");
}

function printCourseSummary(courses: Record<Mode, Course | null>, plans: StudentPlan[]) {
  console.log(hr());
  console.log("TARGET COURSES (pre-existing — resolved read-only, NEVER created/modified)");
  console.log(hr());
  (Object.keys(TARGETS) as Mode[]).forEach((mode) => {
    const c = courses[mode];
    const inCourse = plans.filter((p) => p.mode === mode && !p.skip);
    const emi = inCourse.filter((p) => p.status === "partially_paid").length;
    const full = inCourse.filter((p) => p.status === "fully_paid").length;
    console.log(`  ${pad(mode, 8)} ${pad(TARGETS[mode].slug, 32)} ${c ? `id=${c.id} sticker=${money(c.price)}` : "NOT FOUND"}`);
    console.log(`           importing=${inCourse.length}  (full-paid=${full}, on-EMI=${emi})`);
  });
  console.log("");
}

function printRoundingRows(plans: StudentPlan[]) {
  const rows = plans.filter((p) => p.roundingBefore && p.roundingAfter);
  console.log(hr());
  console.log(`ROUNDING ROWS — sheet 'each × count' vs rebuilt schedule (rebuilt sums EXACTLY to pending). Tolerance: ₹${ROUNDING_TOLERANCE_PER_INSTALLMENT}/installment`);
  console.log(hr());
  if (!rows.length) {
    console.log("  (none)");
    console.log("");
    return;
  }
  for (const p of rows) {
    const beforeSum = (p.roundingBefore ?? []).reduce((a, b) => a + b, 0);
    const afterSum = (p.roundingAfter ?? []).reduce((a, b) => a + b, 0);
    console.log(`  ${pad(p.raw.name, 16)} ${pad(p.mode, 8)} pending ${money(p.pending)}`);
    console.log(`      before: [${(p.roundingBefore ?? []).map(money).join(", ")}] = ${money(beforeSum)}`);
    console.log(`      after : [${(p.roundingAfter ?? []).map(money).join(", ")}] = ${money(afterSum)}  ${afterSum === p.pending ? "✓ exact" : "✗ MISMATCH"}`);
  }
  console.log("");
}

function printDbNotes(plans: StudentPlan[], courses: Record<Mode, Course | null>) {
  const withBuyer = plans.filter((p) => p.existingLoginCode);
  const leads = withBuyer.filter((p) => p.existingBuyerIsLead);
  const mismatches = plans.filter((p) => p.nameMismatch);
  const already = plans.filter((p) => p.alreadyImported);
  console.log(hr());
  console.log("LIVE DB NOTES");
  console.log(hr());
  (Object.keys(TARGETS) as Mode[]).forEach((mode) => {
    const c = courses[mode];
    console.log(`  ${mode} course present: ${c ? `YES (${c.id})` : "NO — WILL ABORT"}`);
  });
  console.log(`  Existing portal accounts on these phones: ${withBuyer.length} (login codes REUSED, never re-minted)`);
  console.log(`  …of which quiz-LEAD accounts: ${leads.length} (access still granted; is_lead not auto-cleared)`);
  console.log(`  Already enrolled in target course (idempotent skip): ${already.length}`);
  console.log(`  Name mismatches (possible different person): ${mismatches.length}`);
  for (const p of mismatches) {
    console.log(`      • ${p.raw.phone}: sheet "${p.raw.name}" vs account "${p.existingBuyerName}" ${p.skip ? "→ needs-review, HELD" : "→ imported (override)"}`);
  }
  console.log("");
}

function printSkippedAndFlagged(plans: StudentPlan[]) {
  const skipped = plans.filter((p) => p.skip);
  const flagged = plans.filter((p) => !p.skip && p.flags.length);
  console.log(hr());
  console.log(`HELD — NOT imported (EXCEPTIONS / STAFF ACTION REQUIRED): ${skipped.length}`);
  console.log(hr());
  if (!skipped.length) console.log("  (none)");
  for (const p of skipped) {
    console.log(`  ✗ ${pad(p.raw.name || "(blank)", 16)} ${pad(p.mode || "?", 8)} ${p.raw.phone || "(no phone)"}`);
    console.log(`      → ${p.skipReason}`);
  }
  console.log("");
  console.log(hr());
  console.log(`SOFT-FLAGGED (modeled & imported — confirm plan/status with staff): ${flagged.length}`);
  console.log(hr());
  if (!flagged.length) console.log("  (none)");
  for (const p of flagged) {
    console.log(`  ⚑ ${pad(p.raw.name, 16)} ${pad(p.mode, 8)} ${p.raw.phone}`);
    for (const f of p.flags) console.log(`      → ${f}`);
  }
  console.log("");
}

function printPerStudent(plans: StudentPlan[]) {
  console.log(hr("─", 132));
  console.log("PER-STUDENT PLAN (imported only)");
  console.log(hr("─", 132));
  console.log(
    `  ${pad("#", 3)}${pad("Name", 16)}${pad("Mode", 8)}${padL("Sticker", 10)}${padL("Discount", 10)}${padL("Eff.Total", 11)}${padL("Paid", 10)}${padL("Pending", 10)}${padL("Inst", 6)}  ${pad("Access", 13)}${pad("Sched OK", 9)}`,
  );
  let i = 0;
  for (const p of plans.filter((x) => !x.skip)) {
    i++;
    const paidSum = p.scheduleFinal.filter((s) => s.paid).reduce((a, s) => a + s.amount, 0);
    const outSum = p.scheduleFinal.filter((s) => !s.paid).reduce((a, s) => a + s.amount, 0);
    const schedOk = paidSum === p.paid && outSum === p.pending;
    console.log(
      `  ${pad(String(i), 3)}${pad(p.raw.name, 16)}${pad(p.mode, 8)}${padL(money(p.sticker), 10)}${padL(p.discount ? money(p.discount) : "—", 10)}${padL(money(p.actualTotal), 11)}${padL(money(p.paid), 10)}${padL(money(p.pending), 10)}${padL(String(p.n), 6)}  ${pad(p.access, 13)}${pad(schedOk ? "✓" : "✗ CHECK", 9)}`,
    );
  }
  console.log("");
}

function printTotals(all: StudentPlan[], imported: StudentPlan[]) {
  const sum = (arr: StudentPlan[], f: (p: StudentPlan) => number) => arr.reduce((a, p) => a + f(p), 0);
  console.log(hr());
  console.log("GRAND TOTALS");
  console.log(hr());
  const line = (label: string, got: number) => console.log(`  ${pad(label, 40)}${padL(money(got), 14)}`);
  console.log(`  ALL ${all.length} SHEET ROWS (incl. held) — informational:`);
  line("Collected (Total Fee received)", sum(all, (p) => p.paid));
  line("Pending (Pending Fee)", sum(all, (p) => p.pending));
  line("Effective total (Total Course fee)", sum(all, (p) => p.actualTotal));
  console.log("");
  console.log(`  IMPORTED ${imported.length} STUDENTS (held removed):`);
  const impCollected = sum(imported, (p) => p.paid);
  const impPending = sum(imported, (p) => p.pending);
  const impEffective = sum(imported, (p) => p.actualTotal);
  const impSticker = sum(imported, (p) => p.sticker);
  const impDiscount = sum(imported, (p) => p.discount);
  line("Sticker total (list price)", impSticker);
  line("Discount total (concessions)", impDiscount);
  line("Effective total (after discount)", impEffective);
  line("Collected", impCollected);
  line("Pending", impPending);
  console.log(`  ${pad("Check: sticker − discount = effective", 40)}${padL(money(impSticker - impDiscount), 14)}  ${impSticker - impDiscount === impEffective ? "✓" : "✗"}`);
  console.log(`  ${pad("Check: collected + pending = effective", 40)}${padL(money(impCollected + impPending), 14)}  ${impCollected + impPending === impEffective ? "✓" : "✗"}`);
  console.log("");
}

function printLoginTable(plans: StudentPlan[], commit: boolean) {
  console.log(hr("─", 150));
  console.log(commit ? "FINAL LOGIN-CODE TABLE (post-commit)" : "LOGIN CODES (existing buyers show real code; new ones minted on commit)");
  console.log(hr("─", 150));
  console.log(
    `  ${pad("Name", 16)}${pad("Mobile", 12)}${pad("Mode", 8)}${padL("Sticker", 9)}${padL("Disc", 8)}${padL("Eff", 9)}${padL("Paid", 9)}${padL("Pend", 9)}${padL("InstRem", 8)}  ${pad("Access", 13)}${pad("LOGIN CODE", 22)}`,
  );
  for (const p of plans.filter((x) => !x.skip)) {
    let code = "(minted on commit)";
    if (p.alreadyImported) code = `${p.existingLoginCode ?? "?"} (already enrolled)`;
    else if (p.existingLoginCode) code = `${p.existingLoginCode} (existing buyer)`;
    console.log(
      `  ${pad(p.raw.name, 16)}${pad(p.raw.phone, 12)}${pad(p.mode, 8)}${padL(money(p.sticker), 9)}${padL(p.discount ? money(p.discount) : "—", 8)}${padL(money(p.actualTotal), 9)}${padL(money(p.paid), 9)}${padL(money(p.pending), 9)}${padL(String(p.n), 8)}  ${pad(p.access, 13)}${pad(code, 22)}`,
    );
  }
  console.log("");
}

// ------------------------------ enrich (DB) ------------------------------
async function enrichFromDb(plans: StudentPlan[], courses: Record<Mode, Course | null>, allowNameMismatch: boolean) {
  for (const p of plans) {
    if (p.skip && !p.alreadyImported) {
      // still resolve identity for held rows so the report can show context, but
      // only when the phone is a valid 10-digit number.
      if (!/^\d{10}$/.test(p.raw.phone)) continue;
    }
    const buyer = await getBuyerByPhone(p.raw.phone).catch(() => null);
    p.existingLoginCode = buyer?.login_code ?? null;
    p.existingBuyerName = buyer?.name ?? null;
    p.existingBuyerIsLead = buyer?.is_lead ?? false;
    if (buyer && !namesLikelySame(p.raw.name, buyer.name)) {
      p.nameMismatch = true;
      if (!allowNameMismatch && !p.errors.some((e) => e.startsWith("Name mismatch"))) {
        p.errors.push(`Name mismatch: sheet "${p.raw.name}" vs existing account "${buyer.name}" on ${p.raw.phone}.`);
        p.skip = true;
        p.skipReason = p.errors.join(" ");
      }
    }
    const target = courses[p.mode as Mode];
    if (target) {
      const enrs = await getCourseEnrollmentsByPhone(p.raw.phone).catch(() => [] as CourseEnrollment[]);
      p.alreadyImported = enrs.some((e) => e.course_id === target.id && e.status !== "cancelled");
    }
  }
}

// ------------------------------- commit ----------------------------------
async function commitImport(plans: StudentPlan[], courses: Record<Mode, Course | null>, nowISO: string) {
  console.log(hr());
  console.log("COMMITTING (idempotent, additive) …");
  console.log(hr());
  let created = 0;
  let skippedExisting = 0;
  for (const p of plans.filter((x) => !x.skip)) {
    const r = p.raw;
    const course = courses[p.mode as Mode];
    if (!course) {
      console.log(`  ⚠ ${r.name}: target course for mode ${p.mode} not resolved → skipped`);
      continue;
    }
    // 1) ensure buyer (idempotent — keeps existing login code)
    const buyer = await ensureBuyer(r.phone, r.name);
    p.existingLoginCode = buyer?.login_code ?? null;

    // 2) idempotency — skip if a non-cancelled enrollment already exists ON THIS COURSE
    const enrs = await getCourseEnrollmentsByPhone(r.phone);
    const existing = enrs.find((e) => e.course_id === course.id && e.status !== "cancelled");
    if (existing) {
      p.alreadyImported = true;
      skippedExisting++;
      console.log(`  ↷ ${pad(r.name, 16)} ${r.phone}  already enrolled in ${course.slug} → skipped`);
      continue;
    }

    // 3) create the enrollment AT STICKER (paid line + N outstanding summing to sticker−paid)
    const enrollment = await addCourseEnrollment({
      phone: r.phone,
      student_name: r.name,
      email: null,
      course_id: course.id,
      course_slug: course.slug,
      course_title: course.title,
      batch_label: p.batchLabel,
      plan_type: p.n > 0 ? "emi" : "full",
      total_fee: p.sticker,
      amount_paid: p.paid,
      installment_count: p.scheduleAtSticker.filter((s) => s.kind === "installment").length,
      status: p.n > 0 ? "partially_paid" : "fully_paid",
      schedule: p.scheduleAtSticker,
    });

    // 4) apply the negotiated discount (sticker − actual) via the EXACT existing path
    if (p.discount > 0) {
      const res = await applyEnrollmentDiscount({
        enrollmentId: enrollment.id,
        discount: p.discount,
        reason: DISCOUNT_REASON,
        appliedBy: IMPORT_ACTOR,
      });
      if (!res.ok) console.log(`  ⚠ ${r.name}: discount failed → ${res.error}`);
    }
    created++;
    console.log(`  ✓ ${pad(r.name, 16)} ${r.phone}  ${pad(p.mode, 8)} ${pad(course.slug, 30)} eff ${money(p.actualTotal)} · code ${buyer?.login_code ?? "?"}`);
  }
  console.log("");
  console.log(`Created: ${created}   Already-enrolled (skipped): ${skippedExisting}`);
  console.log("");
  return { created, skippedExisting };
}

/** Re-read the committed enrollments and reconcile against the sheet figures. */
async function verifyAfterCommit(plans: StudentPlan[], courses: Record<Mode, Course | null>) {
  console.log(hr());
  console.log("POST-COMMIT VERIFICATION (reading back the live enrollments the portal will show)");
  console.log(hr());
  let ok = 0;
  let bad = 0;
  for (const p of plans.filter((x) => !x.skip)) {
    const course = courses[p.mode as Mode];
    if (!course) continue;
    const enrs = await getCourseEnrollmentsByPhone(p.raw.phone);
    const e = enrs.find((x) => x.course_id === course.id && x.status !== "cancelled");
    if (!e) {
      bad++;
      console.log(`  ✗ ${p.raw.name}: no enrollment found after commit`);
      continue;
    }
    const paid = (e.schedule || []).filter((s) => s.paid).reduce((a, s) => a + s.amount, 0);
    const remaining = Math.max(0, e.total_fee - paid);
    const match = e.total_fee === p.actualTotal && paid === p.paid && remaining === p.pending;
    if (match) ok++;
    else {
      bad++;
      console.log(
        `  ✗ ${p.raw.name}: total ${money(e.total_fee)}/${money(p.actualTotal)} paid ${money(paid)}/${money(p.paid)} pend ${money(remaining)}/${money(p.pending)}`,
      );
    }
  }
  console.log(`  Reconciled: ${ok}   Mismatched: ${bad}`);
  console.log(
    bad === 0
      ? "  ✓ Every imported student reconciles to the sheet."
      : "  ✗ Mismatches found — investigate before trusting the import.",
  );
  console.log("");
}

// ---------------------------- course resolve -----------------------------
async function resolveCourses(dbConnected: boolean): Promise<{ courses: Record<Mode, Course | null>; fatal: boolean }> {
  const courses: Record<Mode, Course | null> = { Online: null, Offline: null };
  let fatal = false;
  if (!dbConnected) return { courses, fatal };
  for (const mode of Object.keys(TARGETS) as Mode[]) {
    const t = TARGETS[mode];
    const c = await getCourseBySlug(t.slug).catch(() => null);
    if (!c) {
      console.error(`✗ ${mode} course "${t.slug}" NOT FOUND — aborting (never create/modify a course).`);
      fatal = true;
      continue;
    }
    if (c.id !== t.id) {
      console.error(`✗ ${mode} course "${t.slug}" resolved to id=${c.id}, expected ${t.id} — aborting.`);
      fatal = true;
      continue;
    }
    courses[mode] = c;
  }
  return { courses, fatal };
}

// -------------------------------- main -----------------------------------
async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const allowNameMismatch = args.includes("--allow-name-mismatch");
  const xlsxPath = args.find((a) => !a.startsWith("--"));
  if (!xlsxPath) {
    console.error('Usage: node --env-file=.env.local --import tsx scripts/import-safalta-july.ts "<xlsx>" [--commit]');
    process.exit(1);
  }

  const nowISO = new Date().toISOString();
  const dbConnected = !!getSupabaseAdmin();
  printHeader(commit, dbConnected, xlsxPath);

  if (commit && !dbConnected) {
    console.error("✗ --commit requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (e.g. --env-file=.env.local). Aborting.");
    process.exit(1);
  }

  // Resolve the two pre-existing target courses (read-only). Commit requires both.
  const { courses, fatal } = await resolveCourses(dbConnected);
  if (fatal && commit) process.exit(1);

  const stickerFor = (mode: string): number =>
    (mode === "Online" || mode === "Offline"
      ? courses[mode]?.price ?? TARGETS[mode].fallbackSticker
      : 0);

  // 1) parse
  const rows = parseRows(xlsxPath);

  // 2) duplicate-mobile detection (hold ALL rows sharing a mobile)
  const phoneCounts = new Map<string, number>();
  for (const r of rows) if (/^\d{10}$/.test(r.phone)) phoneCounts.set(r.phone, (phoneCounts.get(r.phone) ?? 0) + 1);
  const dupPhones = new Set([...phoneCounts.entries()].filter(([, c]) => c > 1).map(([p]) => p));

  // 3) plan every row (sticker = routed course price, fixed)
  const plans = rows.map((r) => planStudent(r, stickerFor(r.mode), dupPhones, nowISO));

  // 4) DB enrichment: login codes / identity guard / idempotency (per row's course)
  if (dbConnected) await enrichFromDb(plans, courses, allowNameMismatch);

  const imported = plans.filter((p) => !p.skip);

  // 5) report
  if (dbConnected) printDbNotes(plans, courses);
  printCourseSummary(courses, plans);
  console.log(hr());
  console.log(`TWO-GROUP SPLIT:  Full access (fully paid) = ${imported.filter((p) => p.status === "fully_paid").length}   |   Installments (partially paid) = ${imported.filter((p) => p.status === "partially_paid").length}`);
  console.log("");
  printRoundingRows(plans);
  printSkippedAndFlagged(plans);
  printPerStudent(plans);
  printTotals(plans, imported);
  printLoginTable(plans, false);

  if (!commit) {
    console.log(hr("="));
    console.log("DRY-RUN COMPLETE — NOTHING WRITTEN. Held rows above are EXCEPTIONS (never committed). Re-run with --commit to import the clean rows.");
    console.log(hr("="));
    return;
  }

  // 6) commit (clean rows only; held rows are never written)
  await commitImport(imported, courses, nowISO);
  await enrichFromDb(plans, courses, allowNameMismatch);
  printLoginTable(plans, true);
  await verifyAfterCommit(imported, courses);
  console.log(hr("="));
  console.log("COMMIT COMPLETE. Next: run scripts/reconcile-safalta-july-payments.ts --commit to write the payment ledger rows.");
  console.log(hr("="));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
