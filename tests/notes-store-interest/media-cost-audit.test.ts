import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  estimateCatalogueGb,
  interpretVercelCacheHeader,
  listBandwidthCriticalMediaKeys,
  mediaCdnConfigured,
} from "../../lib/cost/mediaBandwidth.ts";

const middleware = readFileSync(new URL("../../middleware.ts", import.meta.url), "utf8");
const robots = readFileSync(new URL("../../app/robots.ts", import.meta.url), "utf8");
const mediaDelivery = readFileSync(new URL("../../lib/mediaDelivery.ts", import.meta.url), "utf8");
const probe = readFileSync(new URL("../../app/api/ops/media-cost-probe/route.ts", import.meta.url), "utf8");

describe("media cost audit guards", () => {
  test("catalogue lists teaching full MP4s under media/", () => {
    const keys = listBandwidthCriticalMediaKeys();
    assert.ok(keys.some((k) => k.kind === "teaching_full" && k.key.endsWith("/full.mp4")));
    assert.ok(keys.every((k) => k.key.startsWith("media/")));
    assert.ok(estimateCatalogueGb([1024 * 1024 * 1024]) > 0.99);
    assert.equal(interpretVercelCacheHeader("HIT"), "HIT");
    assert.equal(interpretVercelCacheHeader("MISS"), "MISS");
    // Unset in unit tests unless env is injected.
    assert.equal(typeof mediaCdnConfigured(), "boolean");
  });

  test("aggressive bots are short-circuited on /media videos without touching OG images", () => {
    assert.match(middleware, /isExpensivePublicMedia/);
    assert.match(middleware, /\/media\/:path\*/);
    assert.match(middleware, /mp4\|webm\|mov\|m4v\|pdf/);
    assert.match(middleware, /Image\/WebP\/OG posters stay open/);
  });

  test("aggressive bots are short-circuited on force-dynamic Notes Store pages", () => {
    assert.match(middleware, /pathname === "\/notes"/);
    assert.match(middleware, /"\/notes\/:path\*"/);
  });

  test("robots disallow store video prefix but keep public HTML indexable", () => {
    assert.match(robots, /\/media\/store\/videos\//);
    assert.match(robots, /allow:\s*"\/"/);
  });

  test("Vary: Range only applied for partial responses", () => {
    assert.match(mediaDelivery, /if \(obj\.contentRange\) headers\.set\("Vary", "Range"\)/);
  });

  test("ops probe is CRON-guarded and HEAD-only (no body download)", () => {
    assert.match(probe, /authorizeCron/);
    assert.match(probe, /headObject/);
    assert.doesNotMatch(probe, /getObject\(/);
    assert.doesNotMatch(probe, /arrayBuffer\(/);
  });
});
