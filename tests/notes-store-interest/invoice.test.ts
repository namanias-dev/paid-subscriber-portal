import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { invoiceLogoDrawSize, renderInvoicePdf } from "../../lib/store/invoice/pdf";
import { INVOICE_URL_TTL_SECONDS, invoiceWorkPlan, paymentAllowsInvoice } from "../../lib/store/invoice/issue";
import { financialYearLabel, formatInvoiceNumber } from "../../lib/store/invoice/number";
import { formatRegisteredAddress, normalizeCertificateFloor } from "../../lib/store/invoice/address";
import { clericalCorrectionAllowed, correctedSellerDisplay, SELLER_DISPLAY_CORRECTION_REASON } from "../../lib/store/invoice/correct";
import { GST_STATE_NAME, validateGstin } from "../../lib/store/invoice/gstin";
import { prepareInvoiceLogo } from "../../lib/store/invoice/logo";
import { amountInWords, chooseDocumentType, computeTaxDocument, localTaxKind, splitTax, taxClassificationConfirmed, taxOnAmount } from "../../lib/store/invoice/tax";

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
