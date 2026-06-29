/**
 * Webinar lifecycle IST tests (no test framework in this repo — run with node).
 *
 *   node scripts/test-webinar-lifecycle.mjs
 *   TZ=America/New_York node scripts/test-webinar-lifecycle.mjs
 *   TZ=Asia/Kolkata    node scripts/test-webinar-lifecycle.mjs
 *
 * These mirror lib/dates.ts (istInputToISO) and lib/webinarLifecycle.ts
 * (effectiveRegStatus/canRegister). The whole point: "has it ended?" is an
 * epoch-vs-epoch comparison, so the result is identical on ANY server timezone.
 */

const IST_OFFSET_MIN = 330;

// --- mirror of lib/dates.istInputToISO ---
function istInputToISO(local) {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const utcMs =
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) -
    IST_OFFSET_MIN * 60000;
  return new Date(utcMs).toISOString();
}

// --- mirror of lib/webinarLifecycle ---
function parse(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
function registrationCutoffMs(w) {
  return parse(w.registration_closes_at) ?? parse(w.datetime);
}
function isRecordingMode(w) {
  if (w.session_type === "recorded") return true;
  if (w.status === "completed" && !!(w.recording_link && w.recording_link.trim())) return true;
  return false;
}
function effectiveRegStatus(w, now) {
  const manual = (w.registration_status || "OPEN").toUpperCase();
  if (w.active === false || manual === "DISABLED") return "DISABLED";
  if (manual === "DRAFT") return "DRAFT";
  if (manual === "CLOSED") return "CLOSED";
  if (isRecordingMode(w)) return "OPEN";
  const cutoff = registrationCutoffMs(w);
  const autoClose = w.auto_close_registration !== false;
  if (autoClose && cutoff != null && now >= cutoff) return "ENDED";
  return "OPEN";
}
function canRegister(w, now) {
  return effectiveRegStatus(w, now) === "OPEN";
}

// --- tiny assert harness ---
let passed = 0;
let failed = 0;
function assert(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ok  - ${name}`);
  } else {
    failed++;
    console.error(`  FAIL- ${name}`);
  }
}

console.log(`\nServer TZ = ${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone}`);

// 11:00 AM IST webinar today (stored as the correct UTC instant).
const startISO = istInputToISO("2026-07-01T11:00");
// 11:00 IST == 05:30 UTC.
assert("11:00 IST stores as 05:30:00.000Z", startISO === "2026-07-01T05:30:00.000Z");

const w = { datetime: startISO, auto_close_registration: true, registration_status: "OPEN" };

const at1059 = Date.parse(istInputToISO("2026-07-01T10:59"));
const at1101 = Date.parse(istInputToISO("2026-07-01T11:01"));

// CRITICAL: ended at 11:01 IST, still open at 10:59 IST — regardless of server TZ.
assert("OPEN at 10:59 AM IST", canRegister(w, at1059) === true);
assert("ENDED at 11:01 AM IST", canRegister(w, at1101) === false);
assert("effective status ENDED at 11:01", effectiveRegStatus(w, at1101) === "ENDED");

// Custom cutoff overrides start.
const wCutoff = { datetime: startISO, registration_closes_at: istInputToISO("2026-07-01T09:00"), auto_close_registration: true };
assert("custom cutoff closes earlier (10:00 IST > 09:00 cutoff -> closed)", canRegister(wCutoff, Date.parse(istInputToISO("2026-07-01T10:00"))) === false);

// auto_close off keeps it open past start.
const wNoAuto = { datetime: startISO, auto_close_registration: false, registration_status: "OPEN" };
assert("auto_close=false stays OPEN after start", canRegister(wNoAuto, at1101) === true);

// Recording mode stays open (sells recording).
const wRec = { datetime: startISO, status: "completed", recording_link: "https://x/y", auto_close_registration: true };
assert("recording mode stays OPEN after start", canRegister(wRec, at1101) === true);

// Manual states.
assert("manual CLOSED blocks before start", canRegister({ datetime: startISO, registration_status: "CLOSED" }, at1059) === false);
assert("DISABLED via active=false", effectiveRegStatus({ datetime: startISO, active: false }, at1059) === "DISABLED");
assert("DRAFT stays draft", effectiveRegStatus({ datetime: startISO, registration_status: "DRAFT" }, at1059) === "DRAFT");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
