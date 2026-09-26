import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { landingNotebookImage } from "../../lib/store/landingImage";
import { publicStoreMediaUrl } from "../../lib/store/catalogue";

test("a dedicated landing thumbnail wins over the product cover", () => {
  const image = landingNotebookImage({
    store_thumbnail_url: "/media/store/products/economy/thumb-new.webp",
    cover_url: "/media/store/products/economy/cover.webp",
  });
  assert.equal(image.url, "/media/store/products/economy/thumb-new.webp");
  assert.equal(image.fit, "cover");
});

test("the product cover is the landing fallback and is not cropped", () => {
  const image = landingNotebookImage({
    store_thumbnail_url: null,
    cover_url: "/media/store/products/polity/cover.webp",
  });
  assert.equal(image.url, "/media/store/products/polity/cover.webp");
  assert.equal(image.fit, "contain");
});

test("no images keep the notebook fallback", () => {
  const image = landingNotebookImage({ store_thumbnail_url: null, cover_url: null });
  assert.equal(image.url, null);
  assert.equal(image.fit, "contain");
});

test("thumbnail keys use the same public media URL as covers and ignore private keys", () => {
  const url = publicStoreMediaUrl("media/store/products/economy/thumb-1.webp");
  assert.ok(url?.endsWith("media/store/products/economy/thumb-1.webp"));
  assert.equal(publicStoreMediaUrl("store-private/sample-pages/economy/secret.webp"), null);
  assert.equal(publicStoreMediaUrl(null), null);
});

test("admin thumbnail upload and removal are explicit media actions", () => {
  const route = readFileSync(new URL("../../app/api/admin/notes/media/route.ts", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../../components/notes/admin/MediaManager.tsx", import.meta.url), "utf8");
  assert.match(route, /store_thumbnail/);
  assert.match(route, /uploadStoreThumbnail/);
  assert.match(route, /clear_store_thumbnail/);
  assert.match(route, /revalidateTag\(STORE_CACHE_TAG\)/);
  assert.match(manager, /Notes Store thumbnail/);
  assert.match(manager, /Product detail cover/);
  assert.match(manager, /Recommended ratio: \$\{label\}/);
  assert.doesNotMatch(manager, /slug === ["']economy["']|slug === ["']polity["']/);
});
