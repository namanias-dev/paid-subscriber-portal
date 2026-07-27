/**
 * The placeholder parser and the canonical variable registry.
 *
 * THE INCIDENT: the DLT-approved "Installment Reminder" body (gateway template
 * 1777178513223214410) reads
 *
 *   "Hi {first_name}, your course fee installment no. {No_of_Installment} of
 *    Rs.{Fee_in_Rs} is due. Login: {login_url} Code: {login_code} …"
 *
 * The parser was `/\{([a-z_]+)\}/g`, which only matches all-lowercase tokens.
 * `{No_of_Installment}` and `{Fee_in_Rs}` were therefore invisible to it: the
 * template recorded three variables instead of five, the two money tokens were
 * never substituted, and a real student received the literal braces.
 *
 * The body CANNOT be edited to fix this — it must stay byte-identical to the
 * DLT registration or the sender ID is blocked. So these tests pin both halves
 * of the actual fix: a parser that sees every token, and an alias registry that
 * resolves the approved spellings without touching a single character of body text.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate, uniqueVariables, variableSlots, unknownVariables,
} from "../../lib/sms/templates";
import {
  canonicalizeToken, isResolvedValue, lookupVariable, registryKeyFor, VARIABLE_REGISTRY,
} from "../../lib/sms/variableRegistry";

/** The exact production body, byte-for-byte. Do not "tidy" this string. */
const INSTALLMENT_BODY =
  "Hi {first_name}, your course fee installment no. {No_of_Installment} of Rs.{Fee_in_Rs} is due. " +
  "Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.";

/** The regex that shipped the bug, kept here to prove the difference. */
const OLD_VAR_RE = /\{([a-z_]+)\}/g;

function detectedByOldParser(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  OLD_VAR_RE.lastIndex = 0;
  while ((m = OLD_VAR_RE.exec(body))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

describe("the placeholder parser sees every DLT token", () => {
  test("the old parser missed the two money tokens (the bug, reproduced)", () => {
    assert.deepEqual(
      detectedByOldParser(INSTALLMENT_BODY),
      ["first_name", "login_url", "login_code"],
      "If this changes, the historical bug description is wrong.",
    );
  });

  test("the current parser detects all five", () => {
    assert.deepEqual(uniqueVariables(INSTALLMENT_BODY), [
      "first_name", "No_of_Installment", "Fee_in_Rs", "login_url", "login_code",
    ]);
  });

  test("tokens with spaces, capitals, digits and dots are all detected", () => {
    assert.deepEqual(
      uniqueVariables("{No of Installment} {Fee_in_Rs} {webinar_date2} {a.b} {MixedCase}"),
      ["No of Installment", "Fee_in_Rs", "webinar_date2", "a.b", "MixedCase"],
    );
  });

  test("slot order is preserved, duplicates included (DLT slots are positional)", () => {
    assert.deepEqual(
      variableSlots("{first_name} x {Fee_in_Rs} y {first_name}"),
      ["first_name", "Fee_in_Rs", "first_name"],
    );
  });

  test("a body with no variables still parses to nothing", () => {
    // The static promo template has zero tokens and must stay that way.
    assert.deepEqual(uniqueVariables("Fee Rs.50. Enroll: https://vm.ltd/NAMIAS/fBLiXB"), []);
  });
});

describe("the alias registry resolves DLT spellings without editing a body", () => {
  test("both approved installment spellings map to the same canonical variable", () => {
    assert.equal(registryKeyFor("No_of_Installment"), "no_of_installment");
    assert.equal(registryKeyFor("No of Installment"), "no_of_installment");
    assert.equal(registryKeyFor("installment_no"), "no_of_installment");
    assert.equal(registryKeyFor("installment_number"), "no_of_installment");
  });

  test("Fee_in_Rs resolves through every documented alias", () => {
    for (const spelling of ["Fee_in_Rs", "fee_in_rs", "amount", "amount_due", "FEE IN RS"]) {
      assert.equal(registryKeyFor(spelling), "fee_in_rs", `"${spelling}" must resolve to fee_in_rs`);
    }
  });

  test("matching is case- and separator-insensitive", () => {
    assert.equal(canonicalizeToken("No of Installment"), "no_of_installment");
    assert.equal(canonicalizeToken("No_of_Installment"), "no_of_installment");
    assert.equal(canonicalizeToken("  no.of-installment  "), "no_of_installment");
  });

  test("first_name never aliases the full name", () => {
    // A body that asks for the first name must not receive "Priya Sharma".
    assert.equal(registryKeyFor("name"), null);
    const vars = { name: "Priya Sharma", first_name: "Priya" };
    assert.equal(lookupVariable(vars, "first_name"), "Priya");
  });

  test("an unregistered token resolves to nothing rather than guessing", () => {
    assert.equal(registryKeyFor("item_short"), null);
    assert.equal(lookupVariable({ something_else: "x" }, "item_short"), undefined);
  });

  test("every registry entry has a unique canonical key", () => {
    const keys = VARIABLE_REGISTRY.map((v) => v.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("rendering the real installment body", () => {
  test("substitutes both money tokens and leaves no braces", () => {
    const { text, missing } = renderTemplate(INSTALLMENT_BODY, {
      first_name: "Priya",
      no_of_installment: "2",
      fee_in_rs: "8000",
      login_url: "namanias.com/login",
      login_code: "ABCD1234",
    });
    assert.deepEqual(missing, []);
    assert.ok(!/[{}]/.test(text), `rendered body still has braces: ${text}`);
    assert.match(text, /installment no\. 2 of Rs\.8000 is due/);
  });

  test("this is exactly what the student received before the fix", () => {
    // Same vars, old parser semantics: the money tokens survive into the body.
    const brokenRender = INSTALLMENT_BODY.replace(OLD_VAR_RE, (_f, k: string) =>
      ({ first_name: "Priya", login_url: "namanias.com/login", login_code: "ABCD1234" } as Record<string, string>)[k] ?? "");
    assert.match(brokenRender, /installment no\. \{No_of_Installment\} of Rs\.\{Fee_in_Rs\}/);
  });

  test("reports the exact token text as missing so the UI can name it", () => {
    const { missing } = renderTemplate(INSTALLMENT_BODY, { first_name: "Priya" });
    assert.ok(missing.includes("No_of_Installment"));
    assert.ok(missing.includes("Fee_in_Rs"));
  });

  test("the approved spellings are not reported as unknown variables", () => {
    assert.deepEqual(unknownVariables(INSTALLMENT_BODY), []);
  });
});

describe("values that only look resolved are treated as unresolved", () => {
  for (const dud of ["", "   ", "undefined", "null", "NaN", "None"]) {
    test(`"${dud}" is not a sendable value`, () => {
      assert.equal(isResolvedValue(dud), false);
    });
  }
  test("NaN and Infinity are not sendable", () => {
    assert.equal(isResolvedValue(NaN), false);
    assert.equal(isResolvedValue(Infinity), false);
  });
  test("0 IS a sendable value (a zero installment number is a data bug, not a blank)", () => {
    assert.equal(isResolvedValue(0), true);
  });
});
