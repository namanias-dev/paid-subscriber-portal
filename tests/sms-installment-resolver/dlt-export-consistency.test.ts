/**
 * The DLT Approval Sheet must never contradict itself, and the placeholder
 * pattern must never be copied again.
 *
 * The send-path parser was fixed first; an identical lowercase-only copy was
 * left behind in `toDltBody`, plus two more in the Mission Control template
 * editor and the docs generator. Testing the regex itself would not have caught
 * that — each copy passes its own test. The invariant below is what makes a
 * divergence impossible to hide: if any matcher disagrees with any other, the
 * number of `{#var#}` placeholders in an exported body stops equalling the
 * number of rows in its variable mapping.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildDltRows, toDltBody } from "../../lib/sms/dlt";
import { SEED_TEMPLATES } from "../../lib/sms/templates";
import { variableSlots, uniqueVariables, unknownVariables } from "../../lib/sms/placeholders";

const REPO = join(__dirname, "..", "..");
const countVarTokens = (s: string) => (s.match(/\{#var#\}/g) || []).length;

test("every exported template's {#var#} count equals its mapping length", () => {
  const rows = buildDltRows();
  assert.ok(rows.length > 0, "no rows to check");
  for (const r of rows) {
    assert.equal(
      countVarTokens(r.dltBody),
      r.mapping.length,
      `${r.id}: body has ${countVarTokens(r.dltBody)} {#var#} but mapping lists ${r.mapping.length}`,
    );
  }
});

test("mapping order and names match the body's real slot order", () => {
  for (const r of buildDltRows()) {
    const seed = SEED_TEMPLATES.find((t) => t.id === r.id)!;
    const slots = variableSlots(seed.body);
    assert.deepEqual(r.mapping.map((m) => m.variable), slots, `${r.id}: mapping names/order drifted`);
    assert.deepEqual(r.mapping.map((m) => m.slot), slots.map((_, i) => i + 1), `${r.id}: slots not 1..n`);
  }
});

test("the invariant holds for a DLT-spelled body, not just the all-lowercase seeds", () => {
  // The real "Installment Reminder" body. It lives in the database rather than
  // SEED_TEMPLATES, so buildDltRows never sees it today — which is precisely
  // why the stale copy in toDltBody went unnoticed. Assert it directly so the
  // export stays correct if the template is ever seeded or sourced from the DB.
  const body =
    "Hi {first_name}, your course fee installment no. {No_of_Installment} of Rs.{Fee_in_Rs} is due. " +
    "Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.";
  const { dltBody, mapping } = toDltBody(body);

  assert.equal(countVarTokens(dltBody), 5, "all five DLT tokens must convert to {#var#}");
  assert.equal(mapping.length, 5);
  assert.deepEqual(mapping.map((m) => m.variable), [
    "first_name", "No_of_Installment", "Fee_in_Rs", "login_url", "login_code",
  ]);
  assert.ok(!/\{(?!#var#\})[^{}]*\}/.test(dltBody), `unconverted token left in: ${dltBody}`);
});

test("a token with spaces converts too — the spelling that started this", () => {
  const { dltBody, mapping } = toDltBody("no. {No of Installment} of Rs.{Fee_in_Rs}");
  assert.equal(countVarTokens(dltBody), 2);
  assert.deepEqual(mapping.map((m) => m.variable), ["No of Installment", "Fee_in_Rs"]);
});

/** Every .ts/.tsx/.mjs/.js file we own, excluding build output and deps. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "dist", "build", "coverage"].includes(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) acc.push(p);
  }
  return acc;
}

test("no module keeps a private copy of the placeholder regex", () => {
  // The exact defect: a matcher that only accepts lowercase-and-underscore
  // tokens. Four copies of this existed. lib/sms/placeholders.ts owns the
  // pattern now; tests may quote the old one to prove the historical bug.
  const offenders: string[] = [];
  for (const file of sourceFiles(REPO)) {
    const rel = file.slice(REPO.length + 1);
    if (rel.startsWith("tests/")) continue;
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
      if (/\/\\\{\(\[a-z_\]\+\)\\\}\/g/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `stale lowercase-only placeholder regex still present at:\n${offenders.join("\n")}`);
});

test("placeholder helpers are not re-implemented outside lib/sms/placeholders.ts", () => {
  const allowed = new Set(["lib/sms/placeholders.ts"]);
  const offenders: string[] = [];
  for (const file of sourceFiles(REPO)) {
    const rel = file.slice(REPO.length + 1);
    if (rel.startsWith("tests/") || allowed.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    src.split("\n").forEach((line, i) => {
      if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
      // Any brace-token matcher built by hand, whatever character class it uses.
      if (/\/\\\{\(?\[\^?[^\]]*\]\+\)?\\\}\/[gimsuy]*/.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [], `build the matcher from lib/sms/placeholders.ts instead:\n${offenders.join("\n")}`);
});

test("the shared matcher returns a fresh regex, so lastIndex cannot leak", () => {
  const body = "{a} {b}";
  // Two full passes must agree. A module-level /g regex shared between callers
  // would resume from a stale lastIndex and silently return fewer tokens.
  assert.deepEqual(variableSlots(body), ["a", "b"]);
  assert.deepEqual(variableSlots(body), ["a", "b"]);
  assert.deepEqual(uniqueVariables(body), ["a", "b"]);
});

test("alias-aware unknown detection still treats DLT spellings as known", () => {
  assert.deepEqual(unknownVariables("Hi {first_name} {No_of_Installment} {Fee_in_Rs}"), []);
  assert.deepEqual(unknownVariables("Hi {first_name} {totally_made_up}"), ["totally_made_up"]);
});
