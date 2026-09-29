import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { invoiceLogoDrawSize, renderInvoicePdf } from "../../lib/store/invoice/pdf";
import { INVOICE_URL_TTL_SECONDS, invoiceTotalsAgree, invoiceWorkPlan, paymentAllowsInvoice } from "../../lib/store/invoice/issue";
import { financialYearLabel, formatInvoiceNumber } from "../../lib/store/invoice/number";
import { formatRegisteredAddress, normalizeCertificateFloor } from "../../lib/store/invoice/address";
import { clericalCorrectionAllowed, correctedSellerDisplay, SELLER_DISPLAY_CORRECTION_REASON } from "../../lib/store/invoice/correct";
import { GST_STATE_NAME, validateGstin } from "../../lib/store/invoice/gstin";
import { prepareInvoiceLogo } from "../../lib/store/invoice/logo";
import { amountInWords, chooseDocumentType, classificationFromSnapshot, computeTaxDocument, localTaxKind, splitTax, taxClassificationConfirmed, taxOnAmount } from "../../lib/store/invoice/tax";
import { actionRequiredReasons, invoiceStatusLabel, showAdminViewInvoice } from "../../lib/store/adminConsole";

test("invoice numbers reset with the Indian financial year and never reuse a width", () => {
  assert.equal(financialYearLabel(new Date("2026-09-25T00:00:00+05:30")), "26-27");
  assert.equal(financialYearLabel(new Date("2026-03-31T00:00:00+05:30")), "25-26");
  assert.equal(financialYearLabel(new Date("2026-03-31T18:29:59Z")), "25-26");
  assert.equal(financialYearLabel(new Date("2026-03-31T18:30:00Z")), "26-27");
  assert.equal(formatInvoiceNumber("NIA", "26-27", 1), "NIA/26-27/00001");
  assert.equal(formatInvoiceNumber("TEST", "26-27", 12), "TEST/26-27/00012");
  assert.notEqual(formatInvoiceNumber("NIA", "26-27", 1), formatInvoiceNumber("TEST", "26-27", 1));
});

test("exempt notes produce a bill of supply and no GST", () => {
  const doc = computeTaxDocument({
    lines: [
      { name: "Indian Polity Notes", sku: "NOTES-POLITY", hsn: null, qty: 1, lineTotalPaise: 239920, discountPaise: 59980, taxTreatment: "exempt", taxRateBps: 0 },
      { name: "Indian Economy Notes", sku: "NOTES-ECONOMY", hsn: null, qty: 1, lineTotalPaise: 239920, discountPaise: 59980, taxTreatment: "exempt", taxRateBps: 0 },
    ],
    shippingPaise: 5900,
    pricesIncludeTax: true,
    supplierStateCode: "04",
    placeOfSupplyCode: "06",
    chargedTotalPaise: 485740,
  });
  assert.equal(doc.taxPaise, 0);
  assert.equal(doc.grandTotalPaise, 485740);
  assert.equal(chooseDocumentType({ gstin: null, anyTaxable: false }).type, "BILL_OF_SUPPLY");
});

test("inclusive interstate and intrastate tax splits the same paise", () => {
  const inclusive = taxOnAmount(11800, "taxable", 1800, true);
  assert.equal(inclusive, 1800);
  const intra = splitTax(inclusive, false);
  assert.equal(intra.cgst + intra.sgst, 1800);
  assert.equal(intra.igst, 0);
  const inter = splitTax(101, true);
  assert.equal(inter.igst, 101);
  const odd = splitTax(101, false);
  assert.equal(odd.cgst + odd.sgst, 101);
  const doc = computeTaxDocument({
    lines: [{ name: "Notes", sku: "N", hsn: "4901", qty: 2, lineTotalPaise: 23600, discountPaise: 0, taxTreatment: "taxable", taxRateBps: 1800 }],
    shippingPaise: 0,
    pricesIncludeTax: true,
    supplierStateCode: "04",
    placeOfSupplyCode: "27",
    chargedTotalPaise: 23600,
  });
  assert.equal(doc.igstPaise, doc.taxPaise);
  assert.equal(doc.cgstPaise, 0);
  assert.equal(chooseDocumentType({ gstin: null, anyTaxable: true }).type, "INVOICE");
  assert.equal(chooseDocumentType({ gstin: "04AAAAA0000A1Z5", anyTaxable: true }).type, "TAX_INVOICE");
});

test("a bill of supply renders a PDF", async () => {
  const tax = computeTaxDocument({
    lines: [{ name: "Indian Polity Notes", sku: "NOTES-POLITY", hsn: null, qty: 1, lineTotalPaise: 239920, discountPaise: 59980, taxTreatment: "exempt", taxRateBps: 0 }],
    shippingPaise: 5900,
    pricesIncludeTax: true,
    supplierStateCode: null,
    placeOfSupplyCode: "06",
    chargedTotalPaise: 245820,
  });
  const pdf = Buffer.from(await renderInvoicePdf({
      documentType: "BILL_OF_SUPPLY",
      invoiceNumber: "TEST/26-27/00001",
      orderNumber: "NIAS-N-TEST",
      issuedAt: "25 Sep 2026",
      sellerName: "Naman IAS Academy",
      sellerLines: ["Chandigarh"],
      buyerLines: ["Student"],
      shipLines: ["Panchkula, Haryana 134109"],
      paymentReference: "NIASN-N-TEST",
      paidAt: null,
      tax,
      words: amountInWords(245820),
      footer: null,
      attention: null,
  }));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const loaded = await PDFDocument.load(pdf);
  const size = loaded.getPages()[0].getSize();
  assert.ok(Math.abs(size.width - 595.28) < 0.2);
  assert.ok(Math.abs(size.height - 841.89) < 0.2);
});

test("a long address and a logo still fit an A4 page", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const tax = computeTaxDocument({
    lines: [
      { name: "Indian Polity Notes for a very long handwritten compilation title that must wrap inside the description column", sku: "NOTES-POLITY", hsn: null, qty: 1, lineTotalPaise: 239920, discountPaise: 0, taxTreatment: "exempt", taxRateBps: 0 },
      { name: "Indian Economy Notes", sku: "NOTES-ECONOMY", hsn: "4901", qty: 2, lineTotalPaise: 23600, discountPaise: 0, taxTreatment: "taxable", taxRateBps: 1800 },
    ],
    shippingPaise: 5900,
    pricesIncludeTax: true,
    supplierStateCode: "04",
    placeOfSupplyCode: "06",
    chargedTotalPaise: 269420,
  });
  const pdf = Buffer.from(await renderInvoicePdf({
    documentType: "TAX_INVOICE",
    invoiceNumber: "TEST/26-27/00002",
    orderNumber: "NIAS-N-2026-900001",
    issuedAt: "25 Sep 2026",
    sellerName: "Naman Sharma IAS Academy",
    sellerLines: ["SCO 173-174, Sector 17C, Chandigarh, 160017"],
    buyerLines: ["A very long customer name that should wrap rather than run off the page"],
    shipLines: ["House number 1920, a long locality name, Sector 28, Panchkula, Haryana 134109"],
    paymentReference: "NIASN-N-TEST-REFERENCE",
    paidAt: "25 Sep 2026, 10:15 am",
    tax,
    words: amountInWords(269420),
    footer: "Support line for this electronic record.",
    attention: null,
    logoPng: png,
  }));
  const loaded = await PDFDocument.load(pdf);
  assert.ok(loaded.getPageCount() >= 1);
  assert.ok(pdf.length > 1000);
});

test("exclusive tax, rounding, and a refused amount do not invent a document", () => {
  assert.equal(taxOnAmount(10000, "taxable", 1800, false), 1800);
  const exclusive = computeTaxDocument({
    lines: [{ name: "Notes", sku: "N", hsn: "4901", qty: 1, lineTotalPaise: 10000, discountPaise: 500, taxTreatment: "taxable", taxRateBps: 1800 }],
    shippingPaise: 0,
    pricesIncludeTax: false,
    supplierStateCode: "04",
    placeOfSupplyCode: "04",
    chargedTotalPaise: 11800,
  });
  assert.equal(exclusive.cgstPaise + exclusive.utgstPaise, 1800);
  assert.equal(exclusive.sgstPaise, 0);
  assert.equal(exclusive.igstPaise, 0);
  assert.equal(exclusive.roundingPaise, 0);
  assert.equal(exclusive.grandTotalPaise, 11800);
  assert.equal(paymentAllowsInvoice({ paid: true, paymentStatus: "FAILED", paymentAmountPaise: 100, orderTotalPaise: 100 }), "unpaid");
  assert.equal(paymentAllowsInvoice({ paid: true, paymentStatus: "CAPTURED", paymentAmountPaise: 99, orderTotalPaise: 100 }), "mismatch");
  assert.equal(paymentAllowsInvoice({ paid: false, paymentStatus: "CAPTURED", paymentAmountPaise: 100, orderTotalPaise: 100 }), "unpaid");
});

test("a ready invoice is not reissued and a failed PDF can be rendered again", () => {
  assert.equal(invoiceWorkPlan({ status: "READY", updatedAt: new Date().toISOString(), hasKey: true }), "return");
  assert.equal(invoiceWorkPlan({ status: "FAILED", updatedAt: new Date().toISOString(), hasKey: false }), "render");
  assert.equal(invoiceWorkPlan(null), "allocate");
  assert.equal(invoiceWorkPlan({ status: "GENERATING", updatedAt: new Date().toISOString(), hasKey: false }), "wait");
  assert.equal(invoiceWorkPlan({ status: "GENERATING", updatedAt: new Date(Date.now() - 180_000).toISOString(), hasKey: false }), "render");
  assert.ok(INVOICE_URL_TTL_SECONDS >= 300 && INVOICE_URL_TTL_SECONDS <= 600);
});

test("Chandigarh local tax is UTGST and the verified GSTIN matches state 04", () => {
  const ut = splitTax(1800, false, "04");
  assert.equal(ut.cgst, 900);
  assert.equal(ut.utgst, 900);
  assert.equal(ut.sgst, 0);
  assert.equal(localTaxKind("04", false), "UTGST");
  assert.equal(localTaxKind("06", false), "SGST");
  const haryana = computeTaxDocument({
    lines: [{ name: "Notes", sku: "N", hsn: "4901", qty: 1, lineTotalPaise: 11800, discountPaise: 0, taxTreatment: "taxable", taxRateBps: 1800 }],
    shippingPaise: 0,
    pricesIncludeTax: true,
    supplierStateCode: "06",
    placeOfSupplyCode: "06",
    chargedTotalPaise: 11800,
  });
  assert.equal(haryana.sgstPaise, haryana.cgstPaise);
  assert.equal(haryana.utgstPaise, 0);
  const gstin = validateGstin("04CDVPS5346D2Z6");
  assert.equal(gstin.ok, true);
  if (gstin.ok) {
    assert.equal(gstin.stateCode, "04");
    assert.equal(gstin.pan, "CDVPS5346D");
  }
  assert.equal(validateGstin("04CDVPS5346D2Z5").ok, false);
  assert.equal(GST_STATE_NAME["04"], "Chandigarh");
  assert.equal(chooseDocumentType({ gstin: "04CDVPS5346D2Z6", anyTaxable: false }).type, "BILL_OF_SUPPLY");
  assert.equal(chooseDocumentType({ gstin: "04CDVPS5346D2Z6", anyTaxable: true }).type, "TAX_INVOICE");
  assert.equal(taxClassificationConfirmed([{ hsn: null }]), false);
  assert.equal(taxClassificationConfirmed([{ hsn: "49011010", taxTreatment: "nil", taxConfigurationStatus: "CONFIRMED" }]), true);
  assert.equal(taxClassificationConfirmed([{ hsn: "49011010", taxTreatment: "exempt", taxConfigurationStatus: "CONFIRMED" }]), false);
  assert.equal(amountInWords(245820), "INR Two Thousand Four Hundred Fifty-Eight and Twenty Paise Only");
  assert.equal(amountInWords(50000), "INR Five Hundred Only");
  assert.equal(amountInWords(10000000), "INR One Lakh Only");
});

test("a second capture does not allocate another number", () => {
  const seen = new Set<string>();
  function once(orderId: string, number: string) {
    if (seen.has(orderId)) return seen.size;
    seen.add(orderId);
    return number;
  }
  assert.equal(once("order", "NIA/26-27/00001"), "NIA/26-27/00001");
  assert.equal(once("order", "NIA/26-27/00002"), 1);
});

test("registered address uses Sector 17C, PIN 160030, and Second Floor", async () => {
  const raw = normalizeCertificateFloor("SECOUND FLOOR");
  assert.equal(raw.raw, "SECOUND FLOOR");
  assert.equal(raw.display, "Second Floor");
  const lines = formatRegisteredAddress({
    floorDisplay: "SECOUND FLOOR",
    building: "SCO-173-174",
    sector: "17C",
    city: "CHANDIGARH",
    state: "CHANDIGARH",
    pincode: "160030",
  });
  assert.deepEqual(lines, [
    "Second Floor, SCO-173-174",
    "Sector 17C, Chandigarh",
    "Chandigarh 160030, India",
  ]);
  const joined = lines.join("\n");
  assert.equal(joined.includes("160017"), false);
  assert.equal(joined.includes("SECOUND"), false);
  assert.equal(joined.includes("Sector 17,"), false);
  assert.equal(joined.split("Chandigarh").length - 1, 2);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(join(process.cwd(), "lib/store/invoice/NotoSans-Regular.ttf")));
  for (const line of [...lines, "GSTIN: 04CDVPS5346D2Z6"]) {
    assert.ok(font.widthOfTextAtSize(line, 9) <= 250, line);
  }
});

test("invoice logo trims padding, keeps aspect, and stays optional", async () => {
  const padded = await sharp({
    create: { width: 900, height: 900, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{
      input: await sharp({
        create: { width: 240, height: 48, channels: 3, background: { r: 0, g: 0, b: 0 } },
      }).png().toBuffer(),
      left: 80,
      top: 400,
    }])
    .jpeg()
    .toBuffer();
  const prepared = await prepareInvoiceLogo(new Uint8Array(padded));
  assert.ok(prepared);
  const meta = await sharp(Buffer.from(prepared!)).metadata();
  assert.equal(meta.format, "png");
  assert.ok((meta.width || 0) < 400);
  assert.ok((meta.height || 0) <= 168);
  assert.ok((meta.width || 0) > (meta.height || 1));
  const ratio = (meta.width || 1) / (meta.height || 1);
  assert.ok(Math.abs(ratio - 5) < 0.35);
  const draw = invoiceLogoDrawSize(meta.width || 1, meta.height || 1);
  assert.ok(draw.height <= 36 && draw.height > 0);
  assert.ok(draw.width <= 210);
  assert.ok(Math.abs(draw.width / draw.height - ratio) < 0.02);
  assert.equal(await prepareInvoiceLogo(new Uint8Array([1, 2, 3, 4])), null);

  const tax = computeTaxDocument({
    lines: [{ name: "Indian Polity Notes", sku: "NOTES-POLITY", hsn: "49011010", qty: 1, lineTotalPaise: 239920, discountPaise: 59980, taxTreatment: "nil", taxRateBps: 0 }],
    shippingPaise: 5900,
    pricesIncludeTax: true,
    supplierStateCode: "04",
    placeOfSupplyCode: "06",
    chargedTotalPaise: 245820,
  });
  const base = {
    documentType: "BILL_OF_SUPPLY" as const,
    invoiceNumber: "TEST/26-27/00009",
    orderNumber: "NIAS-N-TEST",
    issuedAt: "26 Sep 2026",
    sellerName: "NAMAN SHARMA IAS ACADEMY",
    sellerLines: [
      "Legal name: NAMAN SHARMA",
      "GSTIN: 04CDVPS5346D2Z6",
      ...linesForLogo(),
      "State code: 04",
    ],
    buyerLines: ["Student"],
    shipLines: ["Panchkula, Haryana 134109"],
    paymentReference: "NIASN-N-TEST",
    paidAt: null,
    tax,
    words: amountInWords(245820),
    footer: null,
    attention: null,
  };
  const without = Buffer.from(await renderInvoicePdf({ ...base, logoPng: null }));
  const broken = Buffer.from(await renderInvoicePdf({ ...base, logoPng: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]) }));
  const withLogo = Buffer.from(await renderInvoicePdf({ ...base, logoPng: prepared }));
  assert.equal(without.subarray(0, 5).toString(), "%PDF-");
  assert.equal(broken.subarray(0, 5).toString(), "%PDF-");
  assert.equal(withLogo.subarray(0, 5).toString(), "%PDF-");
  assert.equal(without.toString("latin1").includes("/Subtype /Image") || without.toString("latin1").includes("/Subtype/Image"), false);
  assert.equal(/\/Subtype\s*\/Image/.test(withLogo.toString("latin1")), true);
  assert.ok(withLogo.length < 200_000);
});

test("a clerical correction keeps the invoice number and only replaces seller display", () => {
  assert.equal(clericalCorrectionAllowed({ status: "READY", hasKey: true, hasTaxLines: true }), true);
  assert.equal(clericalCorrectionAllowed({ status: "READY", hasKey: false, hasTaxLines: true }), false);
  assert.equal(clericalCorrectionAllowed({ status: "FAILED", hasKey: true, hasTaxLines: true }), false);
  const oldAddress = correctedSellerDisplay(
    { legalName: "NAMAN SHARMA", gstin: "04CDVPS5346D2Z6", stateCode: "04" },
    { address_line: "SCO-173-174, SECTOR-17", city: "CHANDIGARH", state: "CHANDIGARH", pincode: "160017" },
  );
  assert.equal(oldAddress.ok, false);
  const next = correctedSellerDisplay(
    { legalName: "NAMAN SHARMA", gstin: "04CDVPS5346D2Z6", stateCode: "04" },
    {
      address_floor_display: "Second Floor",
      address_line: "SCO-173-174",
      address_sector: "17C",
      city: "CHANDIGARH",
      state: "CHANDIGARH",
      pincode: "160030",
    },
  );
  assert.equal(next.ok, true);
  assert.deepEqual(next.lines, [
    "Legal name: NAMAN SHARMA",
    "GSTIN: 04CDVPS5346D2Z6",
    "Second Floor, SCO-173-174",
    "Sector 17C, Chandigarh",
    "Chandigarh 160030, India",
    "State code: 04",
  ]);
  assert.equal(SELLER_DISPLAY_CORRECTION_REASON.includes("address"), true);
  assert.equal(next.lines.join(" ").includes("160017"), false);
});

test("order #1011 snapshot can be invoiced without the live product confirmed flag", () => {
  const snapshot = { hsn: "49011010", taxTreatment: "nil" };
  assert.equal(classificationFromSnapshot(snapshot), "CONFIRMED");
  assert.equal(taxClassificationConfirmed([{ ...snapshot, taxConfigurationStatus: classificationFromSnapshot(snapshot) }]), true);
  assert.equal(classificationFromSnapshot({ hsn: null, taxTreatment: "exempt" }), null);
  assert.equal(taxClassificationConfirmed([{ hsn: null, taxTreatment: "exempt", taxConfigurationStatus: null }]), false);
  const doc = computeTaxDocument({
    lines: [{ name: "Indian Economy Notes", sku: "NOTES-ECONOMY", hsn: "49011010", qty: 1, lineTotalPaise: 250_000, discountPaise: 0, taxTreatment: "nil", taxRateBps: 0 }],
    shippingPaise: 9_900,
    pricesIncludeTax: true,
    supplierStateCode: "04",
    placeOfSupplyCode: "04",
    chargedTotalPaise: 259_900,
  });
  assert.equal(doc.shippingPaise, 9_900);
  assert.equal(doc.lines[0].totalPaise, 250_000);
  assert.equal(doc.roundingPaise, 0);
  assert.equal(doc.grandTotalPaise, 259_900);
  assert.equal(invoiceTotalsAgree(doc), true);
  assert.equal(paymentAllowsInvoice({ paid: true, paymentStatus: "CAPTURED", paymentAmountPaise: 205_900, orderTotalPaise: 205_900 }), "ok");
  assert.equal(paymentAllowsInvoice({ paid: true, paymentStatus: "CAPTURED", paymentAmountPaise: 207_877, orderTotalPaise: 205_900 }), "mismatch");
  assert.equal(paymentAllowsInvoice({ paid: false, paymentStatus: "UNCONFIRMED", paymentAmountPaise: 205_900, orderTotalPaise: 205_900 }), "unpaid");
});

test("a ready invoice is reused and a failed PDF keeps the same identity", () => {
  assert.equal(invoiceWorkPlan({ status: "READY", updatedAt: new Date().toISOString(), hasKey: true }), "return");
  assert.equal(invoiceWorkPlan({ status: "FAILED", updatedAt: new Date().toISOString(), hasKey: false }), "render");
  assert.equal(showAdminViewInvoice("READY"), true);
  assert.equal(showAdminViewInvoice("PENDING"), false);
  assert.equal(showAdminViewInvoice(null), false);
  const issue = readFileSync(join(process.cwd(), "lib/store/invoice/issue.ts"), "utf8");
  const verify = readFileSync(join(process.cwd(), "lib/store/payments/verify.ts"), "utf8");
  const repair = issue.slice(issue.indexOf("export async function repairMissingPaidInvoices"));
  assert.equal(repair.includes("recordNotesPurchase"), false);
  assert.equal(repair.includes("fireNotesOrderPaidAlert"), false);
  assert.equal(repair.includes("captureDiscountForOrder"), false);
  assert.match(verify, /scheduleStoreInvoice\(orderId\)/);
  const failed = issue.slice(issue.lastIndexOf("} catch (error) {"), issue.indexOf("async function noteInvoiceBlocked"));
  assert.match(failed, /status: "FAILED"/);
  assert.equal(failed.includes("store_order_payments"), false);
  assert.equal(failed.includes("store_orders"), false);
  assert.match(issue, /let invoiceNumber = existing\?\.invoice_number \|\| null/);
  assert.match(issue, /if \(!existing\)/);
});

test("every Economy order paid after the regression classifies from its own snapshot", () => {
  const economy = { name: "Indian Economy Notes", sku: "NOTES-ECONOMY", hsn: "49011010", qty: 1, lineTotalPaise: 250_000, discountPaise: 0, taxTreatment: "nil", taxRateBps: 0 };
  const polity = { ...economy, name: "Indian Polity Notes", sku: "NOTES-POLITY" };
  const orders = [
    { order: "001024", lines: [economy, polity], shipping: 5_900, total: 505_900 },
    { order: "001026", lines: [economy, polity], shipping: 9_900, total: 509_900 },
    { order: "001030", lines: [economy], shipping: 9_900, total: 259_900 },
    { order: "001032", lines: [economy], shipping: 9_900, total: 259_900 },
    { order: "001037", lines: [economy], shipping: 9_900, total: 259_900 },
    { order: "001045", lines: [economy], shipping: 7_900, total: 257_900 },
  ];
  for (const row of orders) {
    const lines = row.lines.map((line) => ({ ...line, taxConfigurationStatus: classificationFromSnapshot({ hsn: line.hsn, taxTreatment: line.taxTreatment }) }));
    assert.equal(taxClassificationConfirmed(lines), true, row.order);
    const doc = computeTaxDocument({ lines, shippingPaise: row.shipping, pricesIncludeTax: true, supplierStateCode: "04", placeOfSupplyCode: "07", chargedTotalPaise: row.total });
    assert.equal(doc.grandTotalPaise, row.total, row.order);
    assert.equal(doc.roundingPaise, 0, row.order);
    assert.equal(doc.taxPaise, 0, row.order);
    assert.equal(invoiceTotalsAgree(doc), true, row.order);
  }
  assert.equal(classificationFromSnapshot({ hsn: "49011010", taxTreatment: "exempt" }), null);
  assert.equal(classificationFromSnapshot({ hsn: "4901", taxTreatment: "nil" }), "CONFIRMED");
  assert.equal(classificationFromSnapshot({ hsn: "NA", taxTreatment: "nil" }), null);
});

test("a discount the invoice cannot show is refused instead of printed as rounding", () => {
  const doc = computeTaxDocument({
    lines: [{ name: "Indian Economy Notes", sku: "NOTES-ECONOMY", hsn: "49011010", qty: 1, lineTotalPaise: 250_000, discountPaise: 0, taxTreatment: "nil", taxRateBps: 0 }],
    shippingPaise: 5_900,
    pricesIncludeTax: true,
    supplierStateCode: "04",
    placeOfSupplyCode: "04",
    chargedTotalPaise: 205_900,
  });
  assert.equal(doc.roundingPaise, -50_000);
  assert.equal(invoiceTotalsAgree(doc), false);
  assert.equal(invoiceTotalsAgree({ roundingPaise: 100 }), true);
  assert.equal(invoiceTotalsAgree({ roundingPaise: -100 }), true);
  assert.equal(invoiceTotalsAgree({ roundingPaise: 101 }), false);
  const issue = readFileSync(join(process.cwd(), "lib/store/invoice/issue.ts"), "utf8");
  const guard = issue.indexOf("!invoiceTotalsAgree(tax)");
  assert.ok(guard > 0 && guard < issue.indexOf('db.rpc("claim_store_invoice"'), "totals are checked before a number is allocated");
});

test("concurrent issuers for one order share one number and the counter has no gap", async () => {
  const { localFixtureClient, resetLocalFixture } = await import("../../lib/store/localFixture");
  resetLocalFixture();
  const db = localFixtureClient();
  const claim = (orderId: string) => db.rpc("claim_store_invoice", { p_order_id: orderId, p_namespace: "test", p_fy: "26-27", p_prefix: "TEST", p_row: { document_type: "BILL_OF_SUPPLY", grand_total_minor: 259_900 } });
  const [a, b] = await Promise.all([claim("order-a"), claim("order-a")]);
  const rowsA = [...(a.data as Array<{ invoice_number: string; created: boolean }>), ...(b.data as Array<{ invoice_number: string; created: boolean }>)];
  assert.equal(rowsA.filter((row) => row.created).length, 1);
  assert.equal(rowsA[0].invoice_number, rowsA[1].invoice_number);
  const next = (await claim("order-b")).data as Array<{ invoice_number: string; created: boolean }>;
  assert.equal(next[0].created, true);
  assert.equal(Number(next[0].invoice_number.split("/").pop()), Number(rowsA[0].invoice_number.split("/").pop()) + 1);
  const again = (await claim("order-a")).data as Array<{ invoice_number: string; created: boolean }>;
  assert.equal(again[0].created, false);
  assert.equal(again[0].invoice_number, rowsA[0].invoice_number);
});

test("the claim migration numbers and inserts in one transaction without touching existing rows", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/2026-09-29-notes-store-invoice-claim.sql"), "utf8");
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('store_invoice:' \|\| p_order_id::text, 0\)\)/);
  assert.ok(sql.indexOf("from public.store_invoices i") < sql.indexOf("public.next_store_invoice_seq(p_namespace, p_fy)"), "an existing invoice is returned before a number is drawn");
  assert.ok(sql.indexOf("public.next_store_invoice_seq(p_namespace, p_fy)") < sql.indexOf("insert into public.store_invoices"));
  assert.equal(/delete\s+from/i.test(sql), false);
  assert.equal(/update\s+public\.store_invoices/i.test(sql), false);
  assert.equal(/drop\s+/i.test(sql), false);
  assert.match(sql, /revoke all on function public\.claim_store_invoice\(uuid, text, text, text, jsonb\) from public, anon, authenticated/);
});

test("render work is claimed once: a live lease waits and a stale one resumes", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  assert.equal(invoiceWorkPlan({ status: "GENERATING", updatedAt: "2026-09-29T11:59:30Z", hasKey: false }, now), "wait");
  assert.equal(invoiceWorkPlan({ status: "GENERATING", updatedAt: "2026-09-29T11:55:00Z", hasKey: false }, now), "render");
  assert.equal(invoiceWorkPlan({ status: "READY", updatedAt: "2026-09-29T11:00:00Z", hasKey: true }, now), "return");
  assert.equal(invoiceWorkPlan({ status: "READY", updatedAt: "2026-09-29T11:00:00Z", hasKey: false }, now), "render");
  assert.equal(invoiceWorkPlan(null, now), "allocate");
  const issue = readFileSync(join(process.cwd(), "lib/store/invoice/issue.ts"), "utf8");
  const claim = issue.slice(issue.indexOf("async function claimInvoiceRender"), issue.indexOf("function claimRpcMissing"));
  assert.match(claim, /\.eq\("status", current\.status\)/);
  assert.match(claim, /\.eq\("updated_at", current\.updated_at\)/);
  assert.ok(issue.indexOf("claimInvoiceRender(db, orderId)") < issue.indexOf("renderInvoicePdf(model)"));
});

test("the self-heal scan is newest first, paginated, and sends no payment side effects", () => {
  const issue = readFileSync(join(process.cwd(), "lib/store/invoice/issue.ts"), "utf8");
  const scan = issue.slice(issue.indexOf("export async function findPaidOrdersWithoutInvoice"), issue.indexOf("export async function resumeIncompleteInvoices"));
  assert.match(scan, /order\("paid_at", \{ ascending: false \}\)/);
  assert.match(scan, /\.range\(from, from \+ REPAIR_PAGE - 1\)/);
  for (const effect of ["recordNotesPurchase", "fireNotesOrderPaidAlert", "notifyOrderConfirmed", "consumeStoreOfferHold", "storeOpsAlert", "store_order_payments", ".update("]) {
    assert.equal(scan.includes(effect), false, effect);
  }
  const cron = readFileSync(join(process.cwd(), "app/api/cron/notes-store-verify/route.ts"), "utf8");
  assert.match(cron, /await repairMissingPaidInvoices\(\)/);
  assert.match(cron, /await resumeIncompleteInvoices\(\)/);
});

test("capture schedules the invoice after the paid transition and never waits on the PDF", () => {
  const verify = readFileSync(join(process.cwd(), "lib/store/payments/verify.ts"), "utf8");
  const paidBranch = verify.slice(verify.indexOf('if (outcome === "paid") {\n    const { data } = await db'), verify.indexOf("const failedStatus"));
  assert.match(paidBranch, /if \(data\?\.length\) \{\n\s+await consumeStoreOfferHold\(orderId\);\n\s+const \{ scheduleStoreInvoice \} = await import\("\.\.\/invoice\/issue"\);\n\s+scheduleStoreInvoice\(orderId\);/);
  assert.equal(/await scheduleStoreInvoice/.test(verify), false);
  const issue = readFileSync(join(process.cwd(), "lib/store/invoice/issue.ts"), "utf8");
  const schedule = issue.slice(issue.indexOf("export function scheduleStoreInvoice"), issue.indexOf("const UNPAID_ORDER_STATUSES"));
  assert.match(schedule, /\.catch\(/);
  assert.match(schedule, /waitUntil\(work\)/);
});

test("a captured sale never reads as invoice not applicable in admin", () => {
  for (const status of ["READY", "PENDING", "GENERATING", "FAILED", "MISSING"]) {
    assert.notEqual(invoiceStatusLabel(status), "Invoice not applicable", status);
  }
  assert.equal(invoiceStatusLabel(null), "Invoice not applicable");
  assert.equal(showAdminViewInvoice("MISSING"), false);
  assert.ok(actionRequiredReasons({ status: "PROCESSING", invoiceStatus: "MISSING" }).includes("Invoice needs attention"));
  assert.equal(actionRequiredReasons({ status: "PROCESSING", invoiceStatus: "PENDING" }).includes("Invoice needs attention"), false);
  const route = readFileSync(join(process.cwd(), "app/api/admin/notes/orders/route.ts"), "utf8");
  assert.match(route, /const invoiceStatus = storedInvoice \|\| \(paid \? \(invoiceOverdue \? "MISSING" : "PENDING"\) : null\);/);
  const detail = readFileSync(join(process.cwd(), "components/notes/admin/orders/OrderDetail.tsx"), "utf8");
  assert.equal(detail.includes('"Not applicable"'), false);
});

function linesForLogo(): string[] {
  return formatRegisteredAddress({
    floorDisplay: "Second Floor",
    building: "SCO-173-174",
    sector: "17C",
    city: "Chandigarh",
    state: "Chandigarh",
    pincode: "160030",
  });
}
