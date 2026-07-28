import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("unpaged whole-table reads are gone", () => {
  const dp = readFileSync(join(root, "lib/dataProvider.ts"), "utf8");
  const sms = readFileSync(join(root, "lib/sms/store.ts"), "utf8");
  const analytics = readFileSync(join(root, "lib/analytics/queries.ts"), "utf8");

  test("getAllAttempts pages with an id tiebreaker", () => {
    assert.match(dp, /export async function getAllAttempts[\s\S]*?pageThrough<QuizAttempt>/);
    assert.match(dp, /getAllAttempts[\s\S]*?\.order\("id"/);
  });

  test("getAllAnswers pages with an id tiebreaker", () => {
    assert.match(dp, /export async function getAllAnswers[\s\S]*?pageThrough<QuizAnswer>/);
    assert.match(dp, /getAllAnswers[\s\S]*?\.order\("id"/);
  });

  test("getAttemptsByQuiz pages with an id tiebreaker", () => {
    assert.match(dp, /export async function getAttemptsByQuiz[\s\S]*?pageThrough<QuizAttempt>/);
  });

  test("reminder attribution legacy branch no longer uses a fake .limit(5000)", () => {
    assert.doesNotMatch(
      sms,
      /\.is\("course_enrollment_id", null\)\s*\.limit\(5000\)/,
    );
    assert.match(sms, /course_enrollment_id", null[\s\S]*?\.range\(/);
  });

  test("analytics event scans use pageThrough, not a fake high limit", () => {
    assert.doesNotMatch(analytics, /EVENT_FETCH_CAP/);
    assert.doesNotMatch(analytics, /\.limit\(\s*20000\s*\)/);
    assert.match(analytics, /export async function fetchEvents[\s\S]*?pageThrough/);
  });

  test("assertNotCapped helper exists for non-paged reads", () => {
    assert.match(dp, /export function assertNotCapped/);
  });
});
