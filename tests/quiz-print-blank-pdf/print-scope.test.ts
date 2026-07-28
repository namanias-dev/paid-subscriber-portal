/**
 * Regression guard for the 2026-07-27 blank quiz-result PDF.
 *
 * "Save as PDF" on a quiz result opens /quiz-print/[attemptId], which renders
 * the full report and calls window.print(). The report was complete in the DOM
 * and the page count was right, but every sheet came out blank.
 *
 * The cause was in app/globals.css. A print rule written for the payment
 * receipt said `@media print { body * { visibility: hidden } }` and then
 * un-hid only `.receipt-print` / `.receipt-doc`. That rule was global: it
 * applied to every page in the app, so any page without receipt markup printed
 * as blank paper with the correct number of pages. The quiz report was one of
 * them.
 *
 * The isolation is now opt-in — a page renders <PrintIsolate /> to set
 * `body.print-isolate`, and the blanket rule is gated behind that class. These
 * tests pin the parts that, if quietly undone, put blank paper back in front of
 * students: the gate on the blanket rule, the two receipt pages that depend on
 * it, and the quiz report's own print stylesheet.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(REPO, ...p), "utf8");

const GLOBALS = read("app", "globals.css");
const RESULT_PRINT = read("components", "public", "quiz", "ResultPrint.tsx");
const PRINT_ISOLATE = read("components", "ui", "PrintIsolate.tsx");
const RECEIPT_VIEW = read("components", "public", "ReceiptView.tsx");
const STATUS_CLIENT = read("app", "(site)", "payment", "status", "StatusClient.tsx");

/** The class the blanket print rule is gated behind. */
const GATE = "body.print-isolate";

/** Returns the body of every `@media print { ... }` block in a stylesheet. */
function printBlocks(css: string): string[] {
  const out: string[] = [];
  const re = /@media\s+print\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out;
}

/** Splits a media-query body into `{ selector, declarations }` rules. */
function rules(block: string): { selector: string; decls: string }[] {
  const out: { selector: string; decls: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    out.push({ selector: m[1].replace(/\s+/g, " ").trim(), decls: m[2] });
  }
  return out;
}

describe("no print rule may blank a page it does not own", () => {
  const blocks = printBlocks(GLOBALS);

  test("app/globals.css actually has @media print rules to check", () => {
    assert.ok(blocks.length > 0, "found no @media print block in app/globals.css — this guard would pass vacuously.");
  });

  test("every blanket `visibility: hidden` is gated behind body.print-isolate", () => {
    const ungated: string[] = [];
    for (const block of blocks) {
      for (const { selector, decls } of rules(block)) {
        if (!/visibility\s*:\s*hidden/.test(decls)) continue;
        // A rule that hides a whole subtree must name the opt-in gate. Rules
        // that hide one specific component are fine.
        const isBlanket = /\*\s*$/.test(selector) || /^body\b/.test(selector);
        if (isBlanket && !selector.includes(GATE)) ungated.push(selector);
      }
    }
    assert.deepEqual(
      ungated,
      [],
      `these @media print rules hide whole subtrees without the ${GATE} gate, so they blank ` +
        `every page in the app rather than the one they were written for: ${ungated.join(" | ")}`,
    );
  });

  test("the receipt isolation rules still un-hide the receipt itself", () => {
    const all = blocks.join("\n");
    for (const cls of [".receipt-print", ".receipt-doc"]) {
      const re = new RegExp(`${GATE.replace(".", "\\.")}\\s+\\${cls}[^{]*\\{[^}]*visibility\\s*:\\s*visible`);
      assert.match(
        all,
        re,
        `${cls} is no longer made visible under ${GATE} in @media print — the receipt would print blank.`,
      );
    }
  });

  test("app chrome is excluded from print via [data-print-hide]", () => {
    const all = blocks.join("\n");
    assert.match(all, /\[data-print-hide\][^{]*\{[^}]*display\s*:\s*none/, "[data-print-hide] no longer hides chrome when printing.");
  });
});

describe("the pages that depend on print isolation opt into it", () => {
  test("PrintIsolate toggles exactly the class globals.css gates on", () => {
    assert.match(PRINT_ISOLATE, /classList\.add\("print-isolate"\)/, "PrintIsolate no longer adds the print-isolate class.");
    assert.match(PRINT_ISOLATE, /classList\.remove\("print-isolate"\)/, "PrintIsolate must remove the class on unmount, or the gate leaks to the next page.");
  });

  for (const [name, src] of [
    ["components/public/ReceiptView.tsx", RECEIPT_VIEW],
    ["app/(site)/payment/status/StatusClient.tsx", STATUS_CLIENT],
  ] as const) {
    test(`${name} renders <PrintIsolate />`, () => {
      assert.match(src, /import PrintIsolate from "@\/components\/ui\/PrintIsolate"/, `${name} does not import PrintIsolate.`);
      assert.match(src, /<PrintIsolate \/>/, `${name} renders receipt markup but never opts into print isolation, so printing it would emit the whole page instead of just the receipt.`);
    });
  }
});

describe("the quiz report carries its own print stylesheet", () => {
  test("it does not depend on the receipt isolation classes", () => {
    assert.doesNotMatch(
      RESULT_PRINT,
      /receipt-print|receipt-doc|print-isolate/,
      "the quiz report must not reuse the receipt isolation classes; it prints in normal flow so it can paginate.",
    );
  });

  test("prints A4 portrait with margins", () => {
    assert.match(RESULT_PRINT, /@page\s*\{[^}]*size:\s*A4\s+portrait/, "the report no longer pins A4 portrait.");
    assert.match(RESULT_PRINT, /@page\s*\{[^}]*margin:\s*\d+mm/, "the report no longer sets a page margin.");
  });

  test("keeps each question whole across a page break", () => {
    assert.match(RESULT_PRINT, /\.qp-question\s*\{[^}]*break-inside:\s*avoid/, "question blocks may now be split across pages.");
    assert.match(RESULT_PRINT, /\.qp-question\s*\{[^}]*page-break-inside:\s*avoid/, "question blocks lost the legacy page-break-inside fallback.");
  });

  test("forces a light page so dark mode cannot print black blocks", () => {
    const printBlock = printBlocks(RESULT_PRINT).join("\n");
    assert.match(printBlock, /background-color:\s*#fff\s*!important/, "the printed page no longer forces a white background.");
    assert.match(printBlock, /color-scheme:\s*light\s*!important/, "the printed page no longer forces the light colour scheme.");
  });

  test("hides its on-screen controls when printing", () => {
    assert.match(printBlocks(RESULT_PRINT).join("\n"), /\.no-print\s*\{[^}]*display:\s*none/, "the Save as PDF button would print onto the report.");
  });

  test("waits for assets before opening the print dialog", () => {
    assert.match(RESULT_PRINT, /document\.fonts/, "the report no longer waits for fonts, so it can print mid-layout.");
    assert.match(RESULT_PRINT, /requestAnimationFrame/, "the report no longer waits for a painted frame before printing.");
  });
});
