import assert from "node:assert/strict";
import { describe, test } from "node:test";
import sharp from "sharp";
import {
  renderSamplePageDerivative,
  renderProductPhoto,
  samplePageDerivativeKey,
  samplePageOriginalKey,
  SAMPLE_MAX_EDGE,
} from "../../lib/store/media/watermark";

/** An A4 page at 300 DPI carrying EXIF, i.e. what a real scan looks like. */
async function scannedPage(): Promise<Buffer> {
  const W = 2480;
  const H = 3508;
  const lines = Array.from(
    { length: 30 },
    (_, i) => `<rect x="180" y="${420 + i * 90}" width="${1500 + ((i * 137) % 600)}" height="26" fill="#1f2937"/>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#fffdf7"/>${lines}</svg>`;
  return sharp(Buffer.from(svg))
    .jpeg({ quality: 95 })
    .withMetadata({ exif: { IFD0: { Copyright: "Naman IAS", Make: "CanonScan" } } })
    .toBuffer();
}

describe("sample page derivative", () => {
  test("resolution is capped below print usefulness", async () => {
    const out = await renderSamplePageDerivative(await scannedPage());
    assert.ok(Math.max(out.width, out.height) <= SAMPLE_MAX_EDGE, `${out.width}x${out.height}`);
    // At A4 height this is well under 150 DPI, so a print is visibly poor.
    assert.ok(out.height / 11.69 < 120, "derivative would still print acceptably");
  });

  test("every metadata block is dropped", async () => {
    const original = await scannedPage();
    const inMeta = await sharp(original).metadata();
    assert.ok(inMeta.exif, "fixture should carry EXIF to make this test meaningful");

    const out = await renderSamplePageDerivative(original);
    const outMeta = await sharp(out.buffer).metadata();
    assert.equal(outMeta.exif, undefined);
    assert.equal(outMeta.iptc, undefined);
    assert.equal(outMeta.xmp, undefined);
  });

  test("the watermark is in the pixels, not an overlay", async () => {
    const original = await scannedPage();
    const watermarked = await renderSamplePageDerivative(original);

    // The same resize WITHOUT the composite, for comparison.
    const plain = await sharp(original)
      .rotate()
      .resize({ width: SAMPLE_MAX_EDGE, height: SAMPLE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .webp({ quality: 68, effort: 5 })
      .toBuffer();

    const a = await sharp(watermarked.buffer).stats();
    const b = await sharp(plain).stats();
    // Compositing ink onto a mostly-light page must darken it measurably.
    assert.ok(a.channels[0].mean < b.channels[0].mean, "watermark did not alter the pixels");
    assert.notEqual(watermarked.buffer.length, plain.length);
  });

  test("re-encodes to webp regardless of input format", async () => {
    const out = await renderSamplePageDerivative(await scannedPage());
    assert.equal(out.format, "webp");
  });

  test("an unreadable upload throws rather than storing something unprotected", async () => {
    await assert.rejects(() => renderSamplePageDerivative(Buffer.from("this is not an image")));
  });

  test("product photos are stripped and re-encoded but not watermarked", async () => {
    const out = await renderProductPhoto(await scannedPage(), 1600);
    assert.equal(out.format, "webp");
    assert.ok(Math.max(out.width, out.height) <= 1600);
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.exif, undefined);
  });

  test("originals and derivatives live under the private prefix", () => {
    const original = samplePageOriginalKey("prod-1", "file-1", "jpg");
    const derivative = samplePageDerivativeKey("prod-1", "file-1");
    for (const key of [original, derivative]) {
      assert.ok(key.startsWith("store-private/"), key);
    }
    assert.notEqual(original, derivative);
    assert.match(derivative, /\.webp$/);
  });
});
