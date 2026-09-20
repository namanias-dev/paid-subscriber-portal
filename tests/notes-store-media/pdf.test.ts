import { test } from "node:test";
import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import { getPdfPageCount, normalizePageSelection, rasterizePdfPage, MAX_SAMPLE_PAGES } from "../../lib/store/media/pdf.ts";
import { renderSamplePageDerivative } from "../../lib/store/media/watermark.ts";

function makePdf(pages: number): Buffer {
  const doc = new jsPDF();
  for (let i = 1; i <= pages; i++) {
    if (i > 1) doc.addPage();
    doc.text(`UPSC Notes — sample page ${i}`, 20, 30);
  }
  return Buffer.from(doc.output("arraybuffer"));
}

test("normalizePageSelection dedupes, sorts, drops out-of-range and caps at max", () => {
  assert.deepEqual(normalizePageSelection([3, 1, 1, 2], 10), [1, 2, 3]);
  assert.deepEqual(normalizePageSelection([0, 5, 99], 10), [5]);
  const many = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(normalizePageSelection(many, 20).length, MAX_SAMPLE_PAGES);
});

test("getPdfPageCount reads the real page count", async () => {
  assert.equal(await getPdfPageCount(makePdf(5)), 5);
});

test("rasterizePdfPage renders a page and it flows through the watermark pipeline", async () => {
  const pdf = makePdf(3);
  const png = await rasterizePdfPage(pdf, 2);
  assert.ok(png.length > 1000, "rasterized PNG should have real bytes");
  // PNG magic number.
  assert.equal(png[0], 0x89);
  assert.equal(png[1], 0x50);

  const derivative = await renderSamplePageDerivative(png);
  assert.equal(derivative.format, "webp");
  assert.ok(derivative.width > 0 && derivative.height > 0);
  assert.ok(derivative.bytes > 0);
});

test("rasterizePdfPage rejects an out-of-range page", async () => {
  await assert.rejects(() => rasterizePdfPage(makePdf(2), 9));
});
