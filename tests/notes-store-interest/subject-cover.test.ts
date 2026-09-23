import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const rail = readFileSync(new URL("../../components/notes/SubjectRail.tsx", import.meta.url), "utf8");
const stack = readFileSync(new URL("../../components/notes/NotebookStack.tsx", import.meta.url), "utf8");
const catalogue = readFileSync(new URL("../../lib/store/catalogue.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/(site)/notes/page.tsx", import.meta.url), "utf8");
const media = readFileSync(new URL("../../app/api/admin/notes/media/route.ts", import.meta.url), "utf8");

describe("landing subject cover", () => {
  test("each subject card uses the same product cover the card opens", () => {
    assert.match(rail, /coverUrl=\{product\.cover_url\}/);
    assert.match(rail, /href=\{href\}/);
    assert.match(rail, /notesProductPath\(product\.slug\)/);
    assert.doesNotMatch(rail, /polityCover|subject === ["']polity["']/);
    assert.match(page, /<SubjectRail products=\{products\}/);
  });

  test("the landing query already resolves cover_image_key through the shared helper", () => {
    assert.match(catalogue, /cover_image_key/);
    assert.match(catalogue, /cover_url: coverUrl\(/);
    assert.match(catalogue, /function coverUrl/);
    assert.doesNotMatch(catalogue, /unstable_cache\(\s*listActiveProducts/);
  });

  test("a 4:3 cover is contained inside the notebook and a missing cover keeps the fallback", () => {
    assert.match(stack, /object-contain/);
    assert.match(stack, /showCover/);
    assert.match(stack, /Handwritten classroom notes/);
    assert.match(stack, /onError=/);
    assert.doesNotMatch(stack, /object-cover/);
  });

  test("replacing a cover revalidates the notes catalogue tag", () => {
    assert.match(media, /revalidateTag\(STORE_CACHE_TAG\)/);
    assert.match(page, /force-dynamic/);
  });
});
