/**
 * The five Notes templates exactly as registered on DLT
 * (Naman_IAS_Notes_SMS_Template_Approval_Tracker Final.xlsx, rows 6–10).
 *
 * The expected strings below are typed from the tracker independently of
 * lib/sms/notesApproved.ts, so an "improvement" to either copy fails here.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTES_APPROVED_TEMPLATES,
  matchesNotesApprovedSkeleton,
  notesApprovedByKey,
  notesCanonicalRow,
  notesNonAsciiCharacters,
  notesRendererVars,
  notesTemplateDrift,
  renderNotesApprovedText,
} from "../../lib/sms/notesApproved";
import { prepareAndRenderSms } from "../../lib/sms/renderPipeline";

const TRACKER = [
  {
    key: "NOTES_ORDER_CONFIRMED_01",
    dlt: "1777179058711611732",
    type: "Service Implicit",
    text: "Thank you! Your {#alp#} Notes order is confirmed. Rs.{#num#} payment received. Track: {#urg#} Naman Sharma IAS Academy.",
    tokens: ["alp", "num", "urg"],
  },
  {
    key: "NOTES_PAYMENT_PENDING_01",
    dlt: "1777179057396343991",
    type: "Service Implicit",
    text: "Your {#alp#} Notes order is saved, but payment of Rs.{#num#} is pending. Complete payment: {#urg#} Naman Sharma IAS Academy.",
    tokens: ["alp", "num", "urg"],
  },
  {
    key: "NOTES_CHECKOUT_INCOMPLETE_01",
    dlt: "1777179058827172599",
    type: "Service Implicit",
    text: "Your order for Naman Sir’s handwritten UPSC Notes is currently pending. View your order details here: {#urg#} Naman Sharma IAS Academy.",
    tokens: ["urg"],
  },
  {
    key: "NOTES_NEW_LEAD_PROMO_01",
    dlt: "1777179057434102445",
    type: "Promotional",
    text: "Naman Sir’s handwritten UPSC Notes are now available in print. Get copies delivered to your home. Order: {#urg#} Naman Sharma IAS Academy.",
    tokens: ["urg"],
  },
  {
    key: "NOTES_DISCOUNT_NOTES500_01",
    dlt: "1777179057448502622",
    type: "Promotional",
    text: "Special offer: Get Rs.500 off Naman Sir’s handwritten UPSC Notes. Use code NOTES500. Order: {#urg#} Naman Sharma IAS Academy.",
    tokens: ["urg"],
  },
] as const;

describe("approved text, id and type match the DLT tracker byte for byte", () => {
  test("exactly five templates, in tracker order", () => {
    assert.deepEqual(NOTES_APPROVED_TEMPLATES.map((t) => t.key), TRACKER.map((t) => t.key));
  });

  for (const row of TRACKER) {
    test(row.key, () => {
      const t = notesApprovedByKey(row.key)!;
      assert.equal(t.approvedText, row.text);
      assert.equal(Buffer.from(t.approvedText, "utf8").toString("hex"), Buffer.from(row.text, "utf8").toString("hex"));
      assert.equal(t.dltTemplateId, row.dlt);
      assert.equal(t.dltType, row.type);
      assert.equal(t.messageType, row.type === "Promotional" ? "promotional" : "service");
      assert.deepEqual(t.variables.map((v) => v.token), row.tokens);
      assert.deepEqual(t.variables.map((v) => v.slot), row.tokens.map((_, i) => i + 1));
      assert.ok(t.approvedText.endsWith(" Naman Sharma IAS Academy."));
      assert.ok(!t.approvedText.includes("₹"));
    });
  }

  test("the apostrophe is U+2019 in templates 3–5 and absent from 1–2", () => {
    for (const t of NOTES_APPROVED_TEMPLATES) {
      const curly = [...t.approvedText].filter((c) => c.codePointAt(0) === 0x2019).length;
      const straight = [...t.approvedText].filter((c) => c === "'").length;
      assert.equal(straight, 0, `${t.key} has a straight apostrophe`);
      assert.equal(curly, t.sourceRow >= 8 ? 1 : 0, t.key);
      assert.deepEqual(notesNonAsciiCharacters(t), t.sourceRow >= 8 ? ["\u2019"] : []);
    }
  });

  test("the tracker's own confirmed-order sample satisfies the gateway skeleton", () => {
    const t = notesApprovedByKey("NOTES_ORDER_CONFIRMED_01")!;
    assert.equal(matchesNotesApprovedSkeleton(t.dltTemplateId, t.trackerSample), true);
  });
});

describe("the migration seeds the same rows", () => {
  test("every body, DLT id, type and category in the SQL matches the fixture", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(
      join(import.meta.dirname, "..", "..", "supabase", "migrations", "2026-10-11-notes-sms-approved-templates.sql"),
      "utf8",
    ).split("on conflict (id)")[0];
    for (const t of NOTES_APPROVED_TEMPLATES) {
      const re = new RegExp(
        `\\('${t.id}', '${t.key}', '${t.useCase}', '${t.dltTemplateId}', 'NAMIAS', '12', '${t.messageType}', '${t.category}',\\s*(U&)?'([^']+)'`,
      );
      const m = re.exec(sql);
      assert.ok(m, `${t.key} row not found in migration`);
      const body = m[1] ? m[2].replace(/\\([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) : m[2];
      assert.equal(body, t.approvedText, t.key);
    }
  });
});

describe("the generic renderer produces the same bytes as the Notes renderer", () => {
  const cases = [
    { key: "NOTES_ORDER_CONFIRMED_01", values: { alp: "Indian Polity + Indian Economy", num: "5099", urg: "https://www.namanias.com/notes/track" } },
    { key: "NOTES_PAYMENT_PENDING_01", values: { alp: "Indian Economy", num: "2458.20", urg: "https://www.namanias.com/notes/economy" } },
  ] as const;
  for (const c of cases) {
    test(c.key, () => {
      const t = notesApprovedByKey(c.key)!;
      const direct = renderNotesApprovedText(t, c.values);
      assert.ok(direct.ok);
      const generic = prepareAndRenderSms(t.approvedText, t.id, notesRendererVars(t, c.values));
      assert.equal(generic.ok, true, generic.errors.join("; "));
      assert.equal(generic.text, direct.text);
      assert.equal(generic.missing.length, 0);
    });
  }

  test("a \u2019 template is refused by the existing GSM-7 guard (why it is held)", () => {
    const t = notesApprovedByKey("NOTES_CHECKOUT_INCOMPLETE_01")!;
    const r = prepareAndRenderSms(t.approvedText, t.id, notesRendererVars(t, { urg: "https://www.namanias.com/notes" }));
    assert.equal(r.ok, false);
  });
});

describe("drift detection", () => {
  const t = notesApprovedByKey("NOTES_CHECKOUT_INCOMPLETE_01")!;
  const good = notesCanonicalRow(t);

  test("the canonical row has no drift", () => {
    for (const x of NOTES_APPROVED_TEMPLATES) assert.deepEqual(notesTemplateDrift(x, notesCanonicalRow(x)), []);
  });

  test("a straight apostrophe is drift", () => {
    assert.deepEqual(notesTemplateDrift(t, { ...good, body_template: good.body_template.replace("\u2019", "'") }), ["body"]);
  });

  test("a trailing newline is drift", () => {
    assert.deepEqual(notesTemplateDrift(t, { ...good, body_template: `${good.body_template}\n` }), ["body"]);
  });

  test("₹ for Rs. is drift", () => {
    const c = notesApprovedByKey("NOTES_ORDER_CONFIRMED_01")!;
    const row = notesCanonicalRow(c);
    assert.deepEqual(notesTemplateDrift(c, { ...row, body_template: row.body_template.replace("Rs.", "₹") }), ["body"]);
  });

  test("wrong category, DLT id, type, sender, route and status are each drift", () => {
    assert.deepEqual(
      notesTemplateDrift(t, {
        ...good,
        category: "promo",
        gateway_template_id: "1777179057434102445",
        message_type: "promotional",
        sender_id: "OTHERS",
        route: "4",
        status: "draft",
      }).sort(),
      ["category", "dlt_id", "message_type", "route", "sender_id", "status"],
    );
  });

  test("a missing row is drift", () => {
    assert.deepEqual(notesTemplateDrift(t, null), ["missing"]);
  });
});

describe("gateway skeleton", () => {
  const confirm = notesApprovedByKey("NOTES_ORDER_CONFIRMED_01")!;
  const ok = "Thank you! Your Indian Polity Notes order is confirmed. Rs.2499 payment received. Track: https://www.namanias.com/notes/track Naman Sharma IAS Academy.";

  test("accepts the correctly filled text", () => {
    assert.equal(matchesNotesApprovedSkeleton(confirm.dltTemplateId, ok), true);
  });

  test("refuses edited wording, ₹, a foreign URL and an unvalidated amount", () => {
    for (const bad of [
      ok.replace("Thank you!", "Thanks!"),
      ok.replace("Rs.2499", "₹2499"),
      ok.replace("https://www.namanias.com/notes/track", "https://evil.example/notes"),
      ok.replace("https://www.namanias.com/notes/track", "https://www.namanias.com/notes/track?x=1"),
      ok.replace("2499", "2,499"),
      ok.replace("Indian Polity", "{#alp#}"),
      ok.replace(" Naman Sharma IAS Academy.", ""),
    ]) {
      assert.equal(matchesNotesApprovedSkeleton(confirm.dltTemplateId, bad), false, bad);
    }
  });

  test("another template's text under this DLT id is refused", () => {
    assert.equal(
      matchesNotesApprovedSkeleton(
        confirm.dltTemplateId,
        "Your Indian Polity Notes order is saved, but payment of Rs.2499 is pending. Complete payment: https://www.namanias.com/notes Naman Sharma IAS Academy.",
      ),
      false,
    );
  });

  test("non-Notes DLT ids are not this guard's business", () => {
    assert.equal(matchesNotesApprovedSkeleton("1777178513223214410", "anything"), null);
  });
});
