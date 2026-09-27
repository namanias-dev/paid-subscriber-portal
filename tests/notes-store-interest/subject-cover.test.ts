import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const rail = readFileSync(new URL("../../components/notes/SubjectRail.tsx", import.meta.url), "utf8");
const stack = readFileSync(new URL("../../components/notes/NotebookStack.tsx", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../../lib/store/catalogue.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/(site)/notes/page.tsx", import.meta.url), "utf8");
const media = readFileSync(new URL("../../app/api/admin/notes/media/route.ts", import.meta.url), "utf8");

describe("landing subject cover", () => {
  test("each subject card uses that product's landing image and the same product link", () => {
    assert.match(rail, /landingNotebookImage\(product\)/);
    assert.match(rail, /coverUrl=\{image\.url\}/);
    assert.match(rail, /fit=\{image\.fit\}/);
    assert.match(rail, /href=\{href\}/);
    assert.match(rail, /notesProductPath\(product\.slug\)/);
    assert.doesNotMatch(rail, /polityCover|subject === ["']polity["']|subject === ["']economy["']/);
    assert.match(page, /<SubjectRail products=\{products\}/);
  });

  test("the landing query resolves cover and thumbnail keys in one product select", () => {
    assert.match(catalogue, /cover_image_key/);
    assert.match(catalogue, /store_thumbnail_image_key/);
    assert.match(catalogue, /cover_url: publicStoreMediaUrl\(/);
    assert.match(catalogue, /store_thumbnail_url: publicStoreMediaUrl\(/);
    assert.match(catalogue, /export function publicStoreMediaUrl/);
    assert.doesNotMatch(catalogue, /unstable_cache\(\s*listActiveProducts/);
  });

  test("a 4:5 thumbnail covers the notebook and a 4:3 cover stays contained", () => {
    assert.match(stack, /object-contain/);
    assert.match(stack, /object-cover/);
    assert.match(stack, /fit === "cover"/);
    assert.match(stack, /showCover/);
    assert.match(stack, /Handwritten classroom notes/);
    assert.match(stack, /onError=/);
  });

  test("replacing a cover revalidates the notes catalogue tag", () => {
    assert.match(media, /revalidateTag\(STORE_CACHE_TAG\)/);
    assert.match(page, /force-dynamic/);
  });
});
