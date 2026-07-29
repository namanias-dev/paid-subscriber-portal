/**
 * Structural invariants of the two-step sequence.
 *
 * These do not exercise behaviour; they pin the things that would rot silently.
 * A DLT body that drifts by one character is rejected or garbled by the
 * provider, a stray setTimeout reintroduces exactly the failure mode the queue
 * exists to prevent, and a second copy of the delay constant is how "+30 min"
 * becomes "+30 min here and +15 there".
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEED_TEMPLATES, uniqueVariables, analyzeBody } from "../../lib/sms/templates";
import { FOLLOW_UP_DELAY_MINUTES, INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID } from "../../lib/sms/installmentFollowUp";

const ROOT = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * The approved DLT registration, character for character. Written out here as a
 * literal rather than derived from the seed, so this test fails if the seed
 * changes — which is the entire point of it.
 */
const APPROVED_BODY =
  "To pay your installment, login: https://www.namanias.com/login. Open Course Card > View & Pay > select Installment > Pay. Confirmation will follow. Naman Sharma IAS Academy.";

const APPROVED_DLT_ID = "1777178519743722233";

describe("the instructions template matches its DLT registration", () => {
  const seed = SEED_TEMPLATES.find((t) => t.id === INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID);

  test("it is registered in the template store", () => {
    assert.ok(seed, "installment_instructions is not in SEED_TEMPLATES");
  });

  test("the body is BYTE-IDENTICAL to the approved content", () => {
    assert.equal(seed!.body, APPROVED_BODY);
  });

  test("the period straight after /login and the spacing around > are intact", () => {
    // Spelled out separately because these are the two things an editor "fixes".
    assert.ok(seed!.body.includes("https://www.namanias.com/login. Open"));
    assert.ok(seed!.body.includes("Open Course Card > View & Pay > select Installment > Pay."));
  });

  test("the DLT id is the approved one", () => {
    assert.equal(seed!.gateway_template_id, APPROVED_DLT_ID);
  });

  test("it carries NO variables, so nothing can be left unresolved", () => {
    assert.deepEqual(uniqueVariables(seed!.body), []);
    assert.ok(!/[{}]/.test(seed!.body), "the approved body must contain no braces at all");
  });

  test("it is GSM-7 and costs the segments the UI claims", () => {
    const a = analyzeBody(seed!.body);
    assert.equal(a.gsm, true, `non-GSM characters: ${a.nonGsmChars.join(" ")}`);
    assert.equal(a.hasRupeeSymbol, false);
    assert.equal(a.hasEmoji, false);
    assert.equal(a.segments, 2);
  });

  test("it does not collide with the reminder's DLT id", () => {
    const reminderIds = SEED_TEMPLATES.filter((t) => t.id !== INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID)
      .map((t) => t.gateway_template_id)
      .filter(Boolean);
    assert.ok(!reminderIds.includes(APPROVED_DLT_ID));
  });
});

describe("the schedule is durable, not a timer", () => {
  const timerPaths = [
    "lib/sms/installmentFollowUp.ts",
    "app/api/admin/sms/installment-reminder/route.ts",
    "app/api/admin/sms/installment-reminder/bulk/route.ts",
    "app/api/cron/sms-followups/route.ts",
  ];

  for (const p of timerPaths) {
    test(`${p} contains no in-memory timer`, () => {
      const src = read(p);
      // An in-process timer cannot survive the function returning, a deploy, or a
      // crash — the three things that happen constantly on serverless.
      assert.ok(!/\bsetTimeout\s*\(/.test(src), "setTimeout would silently lose the follow-up");
      assert.ok(!/\bsetInterval\s*\(/.test(src), "setInterval would silently lose the follow-up");
    });
  }

  test("the queue is claimed with SKIP LOCKED, so overlapping drains cannot collide", () => {
    const sql = read("supabase/migrations/2026-07-28-sms-scheduled-sends.sql");
    assert.ok(/for update skip locked/i.test(sql));
    assert.ok(/create unique index[\s\S]*sms_scheduled_sends_once_uq/i.test(sql));
  });

  test("the unique constraint is on (installment, template, parent send)", () => {
    const sql = read("supabase/migrations/2026-07-28-sms-scheduled-sends.sql");
    assert.match(
      sql,
      /sms_scheduled_sends_once_uq[\s\S]*\(course_enrollment_id, installment_no, template_id, parent_send_id\)/i,
    );
  });

  test("a cron drains it more often than hourly, so +30 min is not +1 day", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const cron = vercel.crons.find((c) => c.path === "/api/cron/sms-followups");
    // SEV1: heavy crons may be temporarily removed from vercel.json; route + halt still exist.
    if (!cron) {
      const halt = read("lib/incidentHalt.ts");
      assert.match(halt, /SEV1_HALT_HEAVY_CRONS\s*=\s*true/);
      assert.ok(read("app/api/cron/sms-followups/route.ts").includes("heavyCronHalted"));
      return;
    }
    // A daily or hourly schedule would make the 30-minute promise a fiction.
    assert.match(cron.schedule, /^\*\/([1-9]|[1-5][0-9]) \* \* \* \*$/, `schedule "${cron.schedule}" is not minute-based`);
    const everyNMinutes = Number(cron.schedule.split(" ")[0]!.replace("*/", ""));
    assert.ok(everyNMinutes <= 5, `draining every ${everyNMinutes}m is too slow for a 30m promise`);
  });
});

describe("the delay is defined exactly once", () => {
  test("no other module hard-codes 30 minutes for this", () => {
    const src = read("lib/sms/installmentFollowUp.ts");
    // One definition, and it is the exported constant.
    const definitions = src.match(/FOLLOW_UP_DELAY_MINUTES\s*=/g) ?? [];
    assert.equal(definitions.length, 1);
    assert.equal(FOLLOW_UP_DELAY_MINUTES, 30);
  });

  test("the routes import the constant rather than restating the number", () => {
    for (const p of [
      "app/api/admin/sms/installment-reminder/route.ts",
      "app/api/admin/sms/installment-reminder/bulk/route.ts",
    ]) {
      const src = read(p);
      assert.ok(src.includes("FOLLOW_UP_DELAY_MINUTES"), `${p} does not use the shared constant`);
      assert.ok(!/\b30\s*\*\s*60_?000\b/.test(src), `${p} restates the delay in milliseconds`);
    }
  });
});

describe("step 1 is untouched by step 2", () => {
  test('"paid after reminder" still measures from the reminder template, not the instructions', () => {
    const src = read("lib/sms/installmentTracking.ts");
    // The attribution read is scoped to the REMINDER template id. If the
    // instructions template ever joined that query, a student who was sent
    // instructions but never a reminder would show as "reminded".
    assert.ok(src.includes("INSTALLMENT_REMINDER_TEMPLATE_ID"));
    assert.ok(
      !src.includes("INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID"),
      "the instructions template must not take part in reminder→payment attribution",
    );
  });

  test("the follow-up state is carried separately from the reminder state", () => {
    const src = read("lib/sms/installmentTracking.ts");
    assert.ok(/followUps:\s*Record<number, FollowUpView>/.test(src));
  });
});
