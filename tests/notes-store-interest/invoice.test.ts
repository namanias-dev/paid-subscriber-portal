import assert from "node:assert/strict";
import test from "node:test";
import { renderInvoicePdf } from "../../lib/store/invoice/pdf";
import { financialYearLabel, formatInvoiceNumber } from "../../lib/store/invoice/number";
import { amountInWords, chooseDocumentType, computeTaxDocument, splitTax, taxOnAmount } from "../../lib/store/invoice/tax";

test("invoice numbers reset with the Indian financial year and never reuse a width", () => {
  assert.equal(financialYearLabel(new Date("2026-09-25T00:00:00+05:30")), "26-27");
  assert.equal(financialYearLabel(new Date("2026-03-31T00:00:00+05:30")), "25-26");
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
  assert.ok(pdf.length > 1000);
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
