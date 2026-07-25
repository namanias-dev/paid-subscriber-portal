/**
 * PHASE 2 — THE UI MUST NOT SAY ANYTHING IT CANNOT SUPPORT.
 *
 * This CRM's whole value is that the counselling team trusts what it shows. A
 * cell that renders a confident falsehood is worse than an empty one, because
 * nobody goes back to check it. Three of those falsehoods are one careless edit
 * away, so each gets a test.
 *
 *   1. "Legacy — no campaign" on a LIVE row. `campaign_clean` is written only
 *      by the legacy import and is NULL for 100% of live-captured leads
 *      (measured: 0 of 1,027 populated). Keying the phrase off the null alone —
 *      which the first cut of this component did — stamps it on every live row
 *      in the All scope.
 *
 *   2. A capped search count rendered as exact. Free-text search counts are
 *      bounded so a 178k-row scan cannot time out; the real total is then a
 *      floor, and "5,000" would be a number no filter actually produced.
 *
 *   3. An unmasked phone. 178,183 people's numbers are one render away from a
 *      screenshot in a group chat.
 *
 * Rendered with `renderToStaticMarkup` rather than asserted on source text,
 * because what matters is the string a counsellor actually reads.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CampaignCell,
  MaskedPhone,
  ConsentBadge,
  LegacyCallStatus,
  maskPhone,
  formatTotal,
} from "../../components/admin/leadWorklist/cells";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("honest UI — the 'Legacy — no campaign' cell is gated on provenance", () => {
  it("says it for a legacy row that genuinely has no campaign", () => {
    const html = render(
      createElement(CampaignCell, { value: null, campaign: null, isLegacy: true }),
    );
    assert.match(html, /Legacy — no campaign/);
  });

  it("NEVER says it for a live row, which is where the phrase would be a lie", () => {
    const html = render(
      createElement(CampaignCell, { value: null, campaign: null, isLegacy: false }),
    );
    assert.doesNotMatch(
      html, /Legacy/,
      "campaign_clean is null for 100% of live leads; this phrase would fire on every one of them",
    );
    assert.match(html, /—/, "a live row with no campaign gets an honest dash");
  });

  it("falls back to the flat `campaign` column for a live row before giving up", () => {
    const html = render(
      createElement(CampaignCell, { value: null, campaign: "SSC-Foundation", isLegacy: false }),
    );
    assert.match(html, /SSC-Foundation/);
    assert.doesNotMatch(html, /Legacy/);
  });

  it("prefers the cleaned campaign whenever one exists", () => {
    const html = render(
      createElement(CampaignCell, { value: "ssc 2023 batch", campaign: "raw", isLegacy: true }),
    );
    assert.match(html, /ssc 2023 batch/);
    assert.doesNotMatch(html, /Legacy — no campaign/);
  });
});

describe("honest UI — a bounded count is never shown as exact", () => {
  it("renders a capped total with a '+' so it reads as a floor", () => {
    const out = formatTotal(5000, true);
    assert.ok(out && out.includes("+"), `capped total must not read as exact, got: ${out}`);
  });

  it("renders an uncapped total plainly", () => {
    const out = formatTotal(1027, false);
    assert.ok(out && !out.includes("+"), `exact total must not gain a '+', got: ${out}`);
  });

  it("distinguishes the two — a capped 5,000 must not equal an exact 5,000", () => {
    assert.notEqual(formatTotal(5000, true), formatTotal(5000, false));
  });
});

describe("honest UI — PII is masked by default", () => {
  it("maskPhone never returns the full number", () => {
    const masked = maskPhone("9876543210");
    assert.doesNotMatch(masked, /9876543210/, "the full number must never survive masking");
    assert.match(masked, /x/i, "the mask must be visible as a mask");
  });

  it("the default phone cell renders masked, not revealed", () => {
    const html = render(createElement(MaskedPhone, { phone: "9876543210" }));
    assert.doesNotMatch(
      html, /9876543210/,
      "a phone must never be in the initial markup — a screenshot is forever",
    );
  });

  it("masking a null or short value does not throw or invent digits", () => {
    for (const input of [null, undefined, "", "12"]) {
      const out = maskPhone(input as string | null | undefined);
      assert.equal(typeof out, "string");
      assert.doesNotMatch(out, /\d{10}/);
    }
  });
});

describe("honest UI — legacy source wording is never re-mapped", () => {
  it("renders the sheet's own wording verbatim, whitespace and all", () => {
    // The team recognises their own vocabulary; tidying it breaks that trust
    // and there is a separate tidied column when a clean value is wanted.
    for (const raw of ["Not Replied ", "WRONG NO.", "call back  later", "ringing/ NR"]) {
      const html = render(createElement(LegacyCallStatus, { value: raw }));
      assert.ok(
        html.includes(raw.replace(/&/g, "&amp;").trim()) || html.includes(raw.trim()),
        `"${raw}" was altered on the way to the screen`,
      );
    }
  });

  it("an absent call status is a dash, never an invented default", () => {
    const html = render(createElement(LegacyCallStatus, { value: null }));
    assert.doesNotMatch(html, /unknown|none|n\/a|pending/i);
  });
});

describe("honest UI — consent is shown as unknown, not assumed", () => {
  it("renders 'unknown' for the state every legacy lead is in", () => {
    // 178,183 of 178,183 legacy leads are consent_status = 'unknown'. This is
    // the reason every SEND affordance is disabled for them.
    const html = render(createElement(ConsentBadge, { value: "unknown" }));
    assert.match(html, /unknown/i);
    assert.doesNotMatch(html, /consented|opted[- ]?in|granted/i);
  });

  it("a null consent value is not silently upgraded to something permissive", () => {
    const html = render(createElement(ConsentBadge, { value: null }));
    assert.doesNotMatch(html, /explicit|implied|consented|opted[- ]?in/i);
  });
});
