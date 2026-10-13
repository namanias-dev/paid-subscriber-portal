import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isPrivateR2Key,
  isPublicMediaKey,
  publicMediaKeyFromPathname,
} from "../../lib/media/publicPrefix.ts";
import { publicMediaKeyFromPathname as workerKey } from "../../workers/public-media/src/publicKey.ts";
import { mediaObjectKey } from "../../lib/mediaDelivery.ts";
import { stablePublicMediaUrl } from "../../lib/publicMediaUrl.ts";
import { publicCdnUrl } from "../../lib/r2.ts";

describe("public media allowlist", () => {
  test("accepts media/ store paths and rejects traversal", () => {
    assert.equal(
      publicMediaKeyFromPathname("/media/store/videos/naman-sir-teaches-01/full.mp4"),
      "media/store/videos/naman-sir-teaches-01/full.mp4",
    );
    assert.equal(publicMediaKeyFromPathname("/media/../processed/secret.mp4"), null);
    assert.equal(publicMediaKeyFromPathname("/media/%2e%2e/processed/x"), null);
    assert.equal(publicMediaKeyFromPathname("/processed/course/lecture.mp4"), null);
    assert.equal(publicMediaKeyFromPathname("/store-private/sample-pdf/x.pdf"), null);
    assert.equal(publicMediaKeyFromPathname("/media"), null);
  });

  test("Worker helper stays in sync with lib allowlist", () => {
    const samples = [
      "/media/store/samples/anti-defection-law/page-01.webp",
      "/media/../../payment-proofs/x.png",
      "/notes/foo.pdf",
      "/media/store/videos/physical-notes/full.mp4",
    ];
    for (const path of samples) {
      assert.equal(workerKey(path), publicMediaKeyFromPathname(path), path);
    }
  });

  test("private prefixes are classified and never public", () => {
    assert.equal(isPrivateR2Key("processed/c/r/lecture.mp4"), true);
    assert.equal(isPrivateR2Key("payment-proofs/a/b.png"), true);
    assert.equal(isPrivateR2Key("store-private/sample-pdf/a.pdf"), true);
    assert.equal(isPrivateR2Key("media/store/videos/x/full.mp4"), false);
    assert.equal(isPublicMediaKey("media/store/videos/x/full.mp4"), true);
    assert.equal(isPublicMediaKey("processed/x"), false);
  });

  test("mediaObjectKey only builds public media keys", () => {
    assert.equal(mediaObjectKey(["store", "videos", "a", "full.mp4"]), "media/store/videos/a/full.mp4");
    assert.equal(mediaObjectKey(["..", "processed", "x"]), null);
    assert.equal(mediaObjectKey(["."]), null);
  });

  test("stablePublicMediaUrl prefers CDN base when set", () => {
    const prev = process.env.NEXT_PUBLIC_MEDIA_CDN_BASE;
    process.env.NEXT_PUBLIC_MEDIA_CDN_BASE = "https://media.namanias.com";
    try {
      assert.equal(
        stablePublicMediaUrl("media/store/videos/a/full.mp4"),
        "https://media.namanias.com/media/store/videos/a/full.mp4",
      );
      assert.equal(
        stablePublicMediaUrl("store/videos/a/full.mp4"),
        "https://media.namanias.com/media/store/videos/a/full.mp4",
      );
      assert.equal(publicCdnUrl("media/store/videos/a/full.mp4"), "https://media.namanias.com/media/store/videos/a/full.mp4");
      assert.equal(publicCdnUrl("processed/secret.mp4"), null);
      assert.equal(publicCdnUrl("store-private/x.pdf"), null);
    } finally {
      if (prev == null) delete process.env.NEXT_PUBLIC_MEDIA_CDN_BASE;
      else process.env.NEXT_PUBLIC_MEDIA_CDN_BASE = prev;
    }
  });
});
